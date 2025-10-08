import type { RedisClient } from '../core/redis';
import type { MongoAdapter } from '../core/mongoAdapter';
import { buildRetryKey } from '../core/keys';
import { nowMs, calculateBackoff } from '../core/time';

type RedisLike = RedisClient | MongoAdapter;

export interface RetryManagerDefaults {
  namespace: string;
  tenantId: string;
  keyPrefix: string;
  retryBackoffMs: number[];
}

export interface RetryEntry {
  msgId: string;
  payload: any;
  headers: Record<string, string>;
  attempt: number;
  nextRetryMs: number;
}

export class RetryManager {
  constructor(
    private redis: RedisLike,
    private defaults: RetryManagerDefaults
  ) {}

  /**
   * Schedule a message for retry using Sorted Set
   */
  async scheduleRetry(
    topic: string,
    subscription: string,
    msgId: string,
    payload: any,
    headers: Record<string, string>,
    attempt: number,
    backoffMs: number[],
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const retryKey = buildRetryKey(topic, subscription, tenantId, namespace, this.defaults.keyPrefix);

    const delay = calculateBackoff(attempt, backoffMs);
    const nextRetryMs = nowMs() + delay;

    const entry: RetryEntry = {
      msgId,
      payload,
      headers,
      attempt,
      nextRetryMs,
    };

    // Add to sorted set with score = retry timestamp
    await this.redis.zadd(retryKey, nextRetryMs, JSON.stringify(entry));
  }

  /**
   * Get messages ready for retry (score <= now)
   */
  async getReadyRetries(
    topic: string,
    subscription: string,
    limit: number = 100,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<RetryEntry[]> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const retryKey = buildRetryKey(topic, subscription, tenantId, namespace, this.defaults.keyPrefix);

    const now = nowMs();
    
    // Get entries with score <= now
    const entries = await this.redis.zrangebyscore(
      retryKey,
      '-inf',
      now.toString(),
      'LIMIT',
      '0',
      limit.toString()
    );

    return entries.map((e) => JSON.parse(e));
  }

  /**
   * Remove a retry entry after successful requeue
   */
  async removeRetry(
    topic: string,
    subscription: string,
    entry: RetryEntry,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const retryKey = buildRetryKey(topic, subscription, tenantId, namespace, this.defaults.keyPrefix);

    await this.redis.zrem(retryKey, JSON.stringify(entry));
  }

  /**
   * Get retry queue size
   */
  async getRetryCount(
    topic: string,
    subscription: string,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<number> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const retryKey = buildRetryKey(topic, subscription, tenantId, namespace, this.defaults.keyPrefix);

    return await this.redis.zcard(retryKey);
  }

  /**
   * Clear all pending retries
   */
  async clearRetries(
    topic: string,
    subscription: string,
    opts: { namespace?: string; tenantId?: string } = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const retryKey = buildRetryKey(topic, subscription, tenantId, namespace, this.defaults.keyPrefix);

    await this.redis.del(retryKey);
  }
}

