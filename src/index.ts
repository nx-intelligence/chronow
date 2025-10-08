/**
 * Chronow v0.9
 * Redis-backed shared memory and topic/queue dataflow with dual-tier retention
 */

import { createRedis, type RedisClient } from './core/redis';
import { MongoAdapter } from './core/mongoAdapter';
import { ChronosWarm } from './warm/chronosAdapter';
import { SharedMemory } from './shared/sharedMemory';
import { TopicManager } from './bus/topics';
import { Producer } from './bus/producer';
import { Consumer } from './bus/consumer';
import { RetryManager } from './bus/retry';
import { DlqManager } from './bus/dlq';
import { validateConfig } from './core/config';
import type {
  ChronowConfig,
  ChronowDefaults,
  SubscriptionConfig,
  PublishOptions,
  ConsumeOptions,
  ChronowMessage,
  PeekOptions,
} from './types';

type RedisLike = RedisClient | MongoAdapter;

export class Chronow {
  private constructor(
    private redis: RedisLike,
    private warm: ChronosWarm,
    public shared: SharedMemory,
    private topicManager: TopicManager,
    private producer: Producer,
    private consumer: Consumer,
    private retryManager: RetryManager,
    private dlqManager: DlqManager,
    private defaults: ChronowDefaults,
    private mongoOnly: boolean
  ) {}

  /**
   * Initialize Chronow with optional Redis and Chronos-DB
   * If mongoOnly is true or redis config is missing, uses MongoDB-only mode
   */
  static async init(config: ChronowConfig): Promise<Chronow> {
    // Validate configuration
    validateConfig(config);

    const mongoOnly = config.mongoOnly || !config.redis;
    let redis: RedisLike;

    if (mongoOnly) {
      // Use MongoDB adapter instead of Redis
      const mongoUri = config.chronos.config?.dbConnections?.['mongo-primary']?.mongoUri || 'mongodb://localhost:27017';
      const mongoAdapter = new MongoAdapter({
        mongoUri,
        dbName: 'chronow_hot',
        keyPrefix: config.redis?.keyPrefix || 'cw:',
      });

      await mongoAdapter.connect();
      redis = mongoAdapter;
    } else {
      // Create Redis client
      redis = createRedis(config.redis!);

      // Wait for Redis connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
        
        redis.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        redis.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        // If already connected
        if (redis.status === 'ready') {
          clearTimeout(timeout);
          resolve();
        }
      });
    }

    // Initialize Chronos-DB warm tier
    const warm = new ChronosWarm(config.chronos);

    // Build defaults
    const defaults: ChronowDefaults = {
      namespace: config.defaults?.namespace ?? 'default',
      tenantId: config.defaults?.tenantId ?? 'default',
      hotTtlSeconds: config.defaults?.hotTtlSeconds ?? 3600,
      warmRetentionDays: config.defaults?.warmRetentionDays ?? 30,
      maxValueBytes: config.defaults?.maxValueBytes ?? 256 * 1024,
      visibilityTimeoutMs: config.defaults?.visibilityTimeoutMs ?? 30000,
      maxDeliveries: config.defaults?.maxDeliveries ?? 5,
      retryBackoffMs: config.defaults?.retryBackoffMs ?? [1000, 5000, 30000],
      maxStreamLen: config.defaults?.maxStreamLen ?? 100000,
      maxPayloadBytes: config.defaults?.maxPayloadBytes ?? 256 * 1024,
      keyPrefix: config.redis?.keyPrefix ?? 'cw:',
    };

    // Initialize modules
    const shared = new SharedMemory(redis, warm, {
      namespace: defaults.namespace,
      tenantId: defaults.tenantId,
      hotTtlSeconds: defaults.hotTtlSeconds,
      warmRetentionDays: defaults.warmRetentionDays,
      maxValueBytes: defaults.maxValueBytes,
      keyPrefix: defaults.keyPrefix,
    });

    const retryManager = new RetryManager(redis, {
      namespace: defaults.namespace,
      tenantId: defaults.tenantId,
      keyPrefix: defaults.keyPrefix,
      retryBackoffMs: defaults.retryBackoffMs,
    });

    const dlqManager = new DlqManager(redis, warm, {
      namespace: defaults.namespace,
      tenantId: defaults.tenantId,
      keyPrefix: defaults.keyPrefix,
      maxStreamLen: defaults.maxStreamLen,
    });

    const topicManager = new TopicManager(redis, warm, {
      namespace: defaults.namespace,
      tenantId: defaults.tenantId,
      keyPrefix: defaults.keyPrefix,
      visibilityTimeoutMs: defaults.visibilityTimeoutMs,
      maxDeliveries: defaults.maxDeliveries,
      retryBackoffMs: defaults.retryBackoffMs,
    });

    const producer = new Producer(redis, warm, {
      namespace: defaults.namespace,
      tenantId: defaults.tenantId,
      keyPrefix: defaults.keyPrefix,
      maxStreamLen: defaults.maxStreamLen,
      maxPayloadBytes: defaults.maxPayloadBytes,
    });

    const consumer = new Consumer(redis, topicManager, retryManager, dlqManager, {
      namespace: defaults.namespace,
      tenantId: defaults.tenantId,
      keyPrefix: defaults.keyPrefix,
    });

    return new Chronow(
      redis,
      warm,
      shared,
      topicManager,
      producer,
      consumer,
      retryManager,
      dlqManager,
      defaults,
      mongoOnly
    );
  }

  /**
   * Check if running in MongoDB-only mode
   */
  get isMongoOnly(): boolean {
    return this.mongoOnly;
  }

  /**
   * Bus API - Topic and queue management
   */
  get bus() {
    return {
      /**
       * Ensure a topic exists
       */
      ensureTopic: async (
        topic: string,
        opts?: { namespace?: string; tenantId?: string }
      ) => {
        return this.topicManager.ensureTopic(topic, opts);
      },

      /**
       * Ensure a subscription exists for a topic
       */
      ensureSubscription: async (
        topic: string,
        subscription: string,
        config?: SubscriptionConfig,
        opts?: { namespace?: string; tenantId?: string }
      ) => {
        return this.topicManager.ensureSubscription(topic, subscription, config, opts);
      },

      /**
       * Publish a message to a topic
       */
      publish: async <T = any>(
        topic: string,
        payload: T,
        opts?: PublishOptions
      ): Promise<string> => {
        return this.producer.publish(topic, payload, opts);
      },

      /**
       * Publish multiple messages in a batch
       */
      publishBatch: async <T = any>(
        topic: string,
        messages: Array<{ payload: T; headers?: Record<string, string> }>,
        opts?: Omit<PublishOptions, 'headers'>
      ): Promise<string[]> => {
        return this.producer.publishBatch(topic, messages, opts);
      },

      /**
       * Consume messages from a subscription (async iterator)
       */
      consume: <T = any>(
        topic: string,
        subscription: string,
        opts?: ConsumeOptions
      ): AsyncGenerator<ChronowMessage<T>, void, unknown> => {
        return this.consumer.consume<T>(topic, subscription, opts);
      },

      /**
       * Peek at pending messages
       */
      peek: async (
        topic: string,
        subscription: string,
        opts?: PeekOptions
      ) => {
        return this.consumer.peek(topic, subscription, opts?.limit, {
          namespace: opts?.namespace,
          tenantId: opts?.tenantId,
        });
      },

      /**
       * Purge a topic (delete all messages)
       */
      purge: async (
        topic: string,
        opts?: { namespace?: string; tenantId?: string }
      ) => {
        return this.topicManager.purgeTopic(topic, opts);
      },

      /**
       * Get topic statistics
       */
      stats: async (
        topic: string,
        opts?: { namespace?: string; tenantId?: string }
      ) => {
        return this.topicManager.getStats(topic, opts);
      },

      /**
       * Delete a subscription
       */
      deleteSubscription: async (
        topic: string,
        subscription: string,
        opts?: { namespace?: string; tenantId?: string }
      ) => {
        return this.topicManager.deleteSubscription(topic, subscription, opts);
      },

      /**
       * Get DLQ length
       */
      dlqLength: async (
        topic: string,
        opts?: { namespace?: string; tenantId?: string }
      ) => {
        return this.dlqManager.getDlqLength(topic, opts);
      },

      /**
       * Peek at DLQ messages
       */
      peekDlq: async (
        topic: string,
        limit: number = 10,
        opts?: { namespace?: string; tenantId?: string }
      ) => {
        return this.dlqManager.peekDlq(topic, limit, opts);
      },

      /**
       * Purge DLQ
       */
      purgeDlq: async (
        topic: string,
        opts?: { namespace?: string; tenantId?: string }
      ) => {
        return this.dlqManager.purgeDlq(topic, opts);
      },
    };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.warm.close();
    if (this.mongoOnly && this.redis instanceof MongoAdapter) {
      this.redis.disconnect();
    } else {
      (this.redis as RedisClient).disconnect();
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}

// Export types
export * from './types';
export type { ChronowMessage } from './bus/types';

// Export configuration helper
export { configFromEnv } from './core/config';

