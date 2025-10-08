import type { RedisClient } from '../core/redis';
import { buildTopicKey, buildConsumerGroup } from '../core/keys';
import { fromFlatArray, toFlatArray } from '../core/codecs';
import { nowMs } from '../core/time';
import type { ChronowMessage, ConsumeOptions, SubscriptionState } from './types';
import { TopicManager } from './topics';
import { RetryManager } from './retry';
import { DlqManager } from './dlq';

export interface ConsumerDefaults {
  namespace: string;
  tenantId: string;
  keyPrefix: string;
}

export class Consumer {
  constructor(
    private redis: RedisClient,
    private topicManager: TopicManager,
    private retryManager: RetryManager,
    private dlqManager: DlqManager,
    private defaults: ConsumerDefaults
  ) {}

  /**
   * Consume messages from a topic subscription as an async iterator
   */
  async *consume<T = any>(
    topic: string,
    subscription: string,
    opts: ConsumeOptions = {}
  ): AsyncGenerator<ChronowMessage<T>, void, unknown> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const consumerName = opts.consumerName ?? `consumer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);
    const groupName = buildConsumerGroup(subscription);

    // Get subscription config
    const config = await this.topicManager.getSubscriptionConfig(topic, subscription, {
      namespace,
      tenantId,
    });

    if (!config) {
      throw new Error(`Subscription ${subscription} not found for topic ${topic}`);
    }

    // Ensure consumer group exists
    await this.topicManager.ensureSubscription(topic, subscription, config, {
      namespace,
      tenantId,
    });

    // Track delivery counts per message
    const deliveryCounts = new Map<string, number>();

    while (true) {
      // Process pending retries first
      await this.processRetries(topic, subscription, topicKey, namespace, tenantId, config);

      // Auto-claim messages that exceeded visibility timeout
      await this.autoClaim(
        topicKey,
        groupName,
        consumerName,
        config.visibilityTimeoutMs ?? 30000
      );

      // Read new messages
      const items = await this.redis.xreadgroup(
        'GROUP',
        groupName,
        consumerName,
        'BLOCK',
        config.blockMs ?? 10000,
        'COUNT',
        config.count ?? 10,
        'STREAMS',
        topicKey,
        '>'
      );

      if (!items || items.length === 0) {
        continue;
      }

      for (const [_streamKey, entries] of items) {
        for (const [msgId, fields] of entries as Array<[string, string[]]>) {
          const data = fromFlatArray(fields);
          
          // Parse payload and headers
          let payload: T;
          let headers: Record<string, string>;
          
          try {
            payload = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
            headers = typeof data.headers === 'string' ? JSON.parse(data.headers) : data.headers || {};
          } catch (err) {
            console.error(`Failed to parse message ${msgId}:`, err);
            // Ack malformed message to prevent infinite loop
            await this.redis.xack(topicKey, groupName, msgId);
            continue;
          }

          // Track delivery count
          const currentCount = deliveryCounts.get(msgId) || 0;
          const redeliveryCount = currentCount;
          deliveryCounts.set(msgId, currentCount + 1);

          // Create message wrapper
          const message = this.wrapMessage(
            msgId,
            topic,
            subscription,
            payload,
            headers,
            redeliveryCount,
            topicKey,
            groupName,
            config,
            namespace,
            tenantId,
            deliveryCounts
          );

          yield message;
        }
      }
    }
  }

  /**
   * Wrap raw message data into ChronowMessage with ack/nack/deadLetter methods
   */
  private wrapMessage<T>(
    msgId: string,
    topic: string,
    subscription: string,
    payload: T,
    headers: Record<string, string>,
    redeliveryCount: number,
    topicKey: string,
    groupName: string,
    config: SubscriptionState,
    namespace: string,
    tenantId: string,
    deliveryCounts: Map<string, number>
  ): ChronowMessage<T> {
    return {
      id: msgId,
      topic,
      subscription,
      headers,
      payload,
      redeliveryCount,

      ack: async () => {
        await this.redis.xack(topicKey, groupName, msgId);
        deliveryCounts.delete(msgId);
      },

      nack: async (opts = {}) => {
        const deliveries = deliveryCounts.get(msgId) || 1;

        if (deliveries >= (config.maxDeliveries ?? 5)) {
          // Move to DLQ
          await this.dlqManager.sendToDeadLetter(
            topic,
            msgId,
            payload,
            headers,
            'Max deliveries exceeded',
            deliveries,
            { namespace, tenantId }
          );
          await this.redis.xack(topicKey, groupName, msgId);
          deliveryCounts.delete(msgId);
          return;
        }

        if (opts.requeue) {
          // Schedule retry
          await this.retryManager.scheduleRetry(
            topic,
            subscription,
            msgId,
            payload,
            headers,
            deliveries,
            config.retryBackoffMs ?? [1000, 5000, 30000],
            { namespace, tenantId }
          );
          // Ack original message
          await this.redis.xack(topicKey, groupName, msgId);
        }
        // else: leave in pending, will be auto-claimed
      },

      deadLetter: async (reason = 'Manual dead-letter') => {
        const deliveries = deliveryCounts.get(msgId) || 1;
        await this.dlqManager.sendToDeadLetter(
          topic,
          msgId,
          payload,
          headers,
          reason,
          deliveries,
          { namespace, tenantId }
        );
        await this.redis.xack(topicKey, groupName, msgId);
        deliveryCounts.delete(msgId);
      },
    };
  }

  /**
   * Auto-claim messages that exceeded visibility timeout
   */
  private async autoClaim(
    topicKey: string,
    groupName: string,
    consumerName: string,
    visibilityTimeoutMs: number
  ): Promise<void> {
    try {
      // XAUTOCLAIM available in Redis 6.2+
      await this.redis.xautoclaim(
        topicKey,
        groupName,
        consumerName,
        visibilityTimeoutMs,
        '0-0',
        'COUNT',
        10
      );
    } catch (err: any) {
      // Fallback to manual claim for older Redis versions
      if (err.message?.includes('unknown command')) {
        await this.manualClaim(topicKey, groupName, consumerName, visibilityTimeoutMs);
      }
    }
  }

  /**
   * Manual claim for Redis < 6.2
   */
  private async manualClaim(
    topicKey: string,
    groupName: string,
    consumerName: string,
    visibilityTimeoutMs: number
  ): Promise<void> {
    try {
      const pending = await this.redis.xpending(topicKey, groupName, '-', '+', 10);
      const now = nowMs();

      for (const entry of pending as any[]) {
        if (!Array.isArray(entry) || entry.length < 4) continue;
        
        const [msgId, , idleMs] = entry;
        if (idleMs > visibilityTimeoutMs) {
          await this.redis.xclaim(
            topicKey,
            groupName,
            consumerName,
            visibilityTimeoutMs,
            msgId
          );
        }
      }
    } catch {
      // Ignore errors in manual claim
    }
  }

  /**
   * Process pending retries from retry ZSET
   */
  private async processRetries(
    topic: string,
    subscription: string,
    topicKey: string,
    namespace: string,
    tenantId: string,
    config: SubscriptionState
  ): Promise<void> {
    const readyRetries = await this.retryManager.getReadyRetries(topic, subscription, 10, {
      namespace,
      tenantId,
    });

    for (const retry of readyRetries) {
      // Re-add to stream
      const entry = {
        payload: JSON.stringify(retry.payload),
        headers: JSON.stringify(retry.headers),
        retryOf: retry.msgId,
        attempt: retry.attempt.toString(),
      };

      await this.redis.xadd(
        topicKey,
        'MAXLEN',
        '~',
        '100000',
        '*',
        ...toFlatArray(entry)
      );

      // Remove from retry queue
      await this.retryManager.removeRetry(topic, subscription, retry, { namespace, tenantId });
    }
  }

  /**
   * Peek at pending messages without consuming
   */
  async peek(
    topic: string,
    subscription: string,
    limit: number = 10,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<any[]> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);
    const groupName = buildConsumerGroup(subscription);

    try {
      const pending = await this.redis.xpending(topicKey, groupName, '-', '+', limit);
      return pending as any[];
    } catch {
      return [];
    }
  }
}

