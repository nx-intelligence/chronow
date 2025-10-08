import type { RedisClient } from '../core/redis';
import { encodeJson, decodeJson } from '../core/codecs';
import { buildKey } from '../core/keys';
import { ChronosWarm } from '../warm/chronosAdapter';

export interface SharedSetOptions {
  namespace?: string;
  tenantId?: string;
  hotTtlSeconds?: number;
  warm?: {
    persist?: boolean;
    upsertStrategy?: 'append' | 'latest';
    retentionDays?: number;
    maxVersions?: number;
  };
  maxValueBytes?: number;
}

export interface SharedGetOptions {
  namespace?: string;
  tenantId?: string;
}

export interface SharedDelOptions {
  namespace?: string;
  tenantId?: string;
  tombstone?: boolean;
}

export interface SharedMemoryDefaults {
  namespace: string;
  tenantId: string;
  hotTtlSeconds: number;
  warmRetentionDays: number;
  maxValueBytes: number;
  keyPrefix: string;
}

export class SharedMemory {
  constructor(
    private redis: RedisClient,
    private warm: ChronosWarm,
    private defaults: SharedMemoryDefaults
  ) {}

  /**
   * Set a shared memory value with dual persistence
   */
  async set(name: string, value: any, opts: SharedSetOptions = {}): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const hotTtlSeconds = opts.hotTtlSeconds ?? this.defaults.hotTtlSeconds;
    const maxValueBytes = opts.maxValueBytes ?? this.defaults.maxValueBytes;

    const key = buildKey(
      { tenantId, namespace, kind: 'sm', name },
      this.defaults.keyPrefix
    );

    // Encode and store in Redis with TTL
    const buf = encodeJson(value, maxValueBytes);
    await this.redis.set(key, buf, 'EX', hotTtlSeconds);

    // Optionally persist to Chronos-DB warm tier
    if (opts.warm?.persist) {
      await this.warm.saveShared(namespace, name, value, {
        tenantId,
        retentionDays: opts.warm.retentionDays ?? this.defaults.warmRetentionDays,
        upsertStrategy: opts.warm.upsertStrategy ?? 'latest',
        maxVersions: opts.warm.maxVersions,
      });
    }
  }

  /**
   * Get a shared memory value (hot first, fallback to warm)
   */
  async get<T = any>(name: string, opts: SharedGetOptions = {}): Promise<T | null> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;

    const key = buildKey(
      { tenantId, namespace, kind: 'sm', name },
      this.defaults.keyPrefix
    );

    // Try Redis hot tier first
    const raw = await this.redis.getBuffer(key);
    if (raw) {
      return decodeJson<T>(raw);
    }

    // Fallback to Chronos-DB warm tier
    return this.warm.loadShared<T>(namespace, name, { tenantId });
  }

  /**
   * Delete a shared memory value
   */
  async del(name: string, opts: SharedDelOptions = {}): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;

    const key = buildKey(
      { tenantId, namespace, kind: 'sm', name },
      this.defaults.keyPrefix
    );

    // Remove from Redis
    await this.redis.del(key);

    // Optionally tombstone in Chronos-DB
    if (opts.tombstone) {
      await this.warm.tombstoneShared(namespace, name, { tenantId });
    }
  }

  /**
   * Check if a key exists in hot tier
   */
  async exists(name: string, opts: SharedGetOptions = {}): Promise<boolean> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;

    const key = buildKey(
      { tenantId, namespace, kind: 'sm', name },
      this.defaults.keyPrefix
    );

    const result = await this.redis.exists(key);
    return result === 1;
  }

  /**
   * Set TTL on an existing key
   */
  async expire(name: string, ttlSeconds: number, opts: SharedGetOptions = {}): Promise<boolean> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;

    const key = buildKey(
      { tenantId, namespace, kind: 'sm', name },
      this.defaults.keyPrefix
    );

    const result = await this.redis.expire(key, ttlSeconds);
    return result === 1;
  }
}

