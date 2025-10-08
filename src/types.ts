/**
 * Global types and configuration for Chronow
 */

import type { RedisOptions } from './core/redis';
import type { ChronosConfig } from './warm/chronosAdapter';

export interface ChronowConfig {
  // Redis is now optional - if not provided, uses MongoDB-only mode
  redis?: RedisOptions;
  // MongoDB mode configuration
  mongoOnly?: boolean;  // If true, bypass Redis entirely and use MongoDB for hot tier
  chronos: ChronosConfig;
  defaults?: {
    namespace?: string;
    tenantId?: string;
    hotTtlSeconds?: number;
    warmRetentionDays?: number;
    maxValueBytes?: number;
    visibilityTimeoutMs?: number;
    maxDeliveries?: number;
    retryBackoffMs?: number[];
    maxStreamLen?: number;
    maxPayloadBytes?: number;
    pollIntervalMs?: number;  // For MongoDB-only mode polling
  };
}

export interface ChronowDefaults {
  namespace: string;
  tenantId: string;
  hotTtlSeconds: number;
  warmRetentionDays: number;
  maxValueBytes: number;
  visibilityTimeoutMs: number;
  maxDeliveries: number;
  retryBackoffMs: number[];
  maxStreamLen: number;
  maxPayloadBytes: number;
  keyPrefix: string;
}

// Re-export commonly used types
export type {
  RedisClient,
  RedisOptions,
} from './core/redis';

export type {
  ChronosConfig,
  WarmPersistOptions,
} from './warm/chronosAdapter';

export type {
  SharedSetOptions,
  SharedGetOptions,
  SharedDelOptions,
} from './shared/sharedMemory';

export type {
  SubscriptionConfig,
  PublishOptions,
  ConsumeOptions,
  ChronowMessage,
  TopicStats,
  PeekOptions,
  ReplayOptions,
} from './bus/types';

