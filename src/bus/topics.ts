import type { RedisClient } from '../core/redis';
import { buildTopicKey, buildConsumerGroup } from '../core/keys';
import type { SubscriptionConfig, SubscriptionState } from './types';
import { ChronosWarm } from '../warm/chronosAdapter';

export interface TopicManagerDefaults {
  namespace: string;
  tenantId: string;
  keyPrefix: string;
  visibilityTimeoutMs: number;
  maxDeliveries: number;
  retryBackoffMs: number[];
}

export class TopicManager {
  constructor(
    private redis: RedisClient,
    private warm: ChronosWarm,
    private defaults: TopicManagerDefaults
  ) {}

  /**
   * Ensure a topic stream exists
   */
  async ensureTopic(
    topic: string,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    // Create stream if it doesn't exist (XADD with NOMKSTREAM check)
    // We'll use XGROUP CREATE with MKSTREAM to ensure it exists
    try {
      await this.redis.xgroup('CREATE', topicKey, '_init', '0', 'MKSTREAM');
      // Delete the temporary group
      await this.redis.xgroup('DESTROY', topicKey, '_init');
    } catch (err: any) {
      // Ignore BUSYGROUP error (stream already exists)
      if (!err.message?.includes('BUSYGROUP')) {
        throw err;
      }
    }

    // Persist topic metadata to Chronos-DB
    await this.warm.saveTopic(topic, 1, { tenantId });
  }

  /**
   * Ensure a subscription (consumer group) exists for a topic
   */
  async ensureSubscription(
    topic: string,
    subscription: string,
    config: SubscriptionConfig = {},
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);
    const groupName = buildConsumerGroup(subscription);

    // Ensure topic exists first
    await this.ensureTopic(topic, { namespace, tenantId });

    // Create consumer group
    try {
      await this.redis.xgroup('CREATE', topicKey, groupName, '0', 'MKSTREAM');
    } catch (err: any) {
      // Ignore BUSYGROUP error (group already exists)
      if (!err.message?.includes('BUSYGROUP')) {
        throw err;
      }
    }

    // Store subscription config in Redis hash
    const configKey = `${topicKey}:sub:${subscription}:config`;
    const state: SubscriptionState = {
      topic,
      subscription,
      visibilityTimeoutMs: config.visibilityTimeoutMs ?? this.defaults.visibilityTimeoutMs,
      maxDeliveries: config.maxDeliveries ?? this.defaults.maxDeliveries,
      retryBackoffMs: config.retryBackoffMs ?? this.defaults.retryBackoffMs,
      deadLetterEnabled: config.deadLetterEnabled ?? true,
      shardCount: config.shardCount ?? 1,
      blockMs: config.blockMs ?? 10000,
      count: config.count ?? 10,
      createdAt: Date.now(),
    };

    await this.redis.hset(configKey, 'config', JSON.stringify(state));
  }

  /**
   * Get subscription configuration
   */
  async getSubscriptionConfig(
    topic: string,
    subscription: string,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<SubscriptionState | null> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);
    const configKey = `${topicKey}:sub:${subscription}:config`;

    const configStr = await this.redis.hget(configKey, 'config');
    if (!configStr) {
      return null;
    }

    return JSON.parse(configStr);
  }

  /**
   * Delete a subscription (consumer group)
   */
  async deleteSubscription(
    topic: string,
    subscription: string,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);
    const groupName = buildConsumerGroup(subscription);

    // Destroy consumer group
    await this.redis.xgroup('DESTROY', topicKey, groupName);

    // Delete config
    const configKey = `${topicKey}:sub:${subscription}:config`;
    await this.redis.del(configKey);
  }

  /**
   * Purge a topic (delete all messages)
   */
  async purgeTopic(
    topic: string,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    // Delete the stream
    await this.redis.del(topicKey);

    // Recreate it
    await this.ensureTopic(topic, { namespace, tenantId });
  }

  /**
   * Get topic statistics
   */
  async getStats(
    topic: string,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<any> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    try {
      const info = await this.redis.xinfo('STREAM', topicKey);
      return {
        topic,
        length: info[1], // Stream length
        groups: info[5], // Number of groups
      };
    } catch {
      return {
        topic,
        length: 0,
        groups: 0,
      };
    }
  }
}

