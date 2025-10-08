/**
 * Core types for Chronow bus (topics, subscriptions, messages)
 */

export interface SubscriptionConfig {
  visibilityTimeoutMs?: number;
  maxDeliveries?: number;
  retryBackoffMs?: number[];
  deadLetterEnabled?: boolean;
  shardCount?: number;
  blockMs?: number;
  count?: number;
}

export interface PublishOptions {
  persistWarmCopy?: boolean;
  headers?: Record<string, string>;
  namespace?: string;
  tenantId?: string;
}

export interface ConsumeOptions {
  namespace?: string;
  tenantId?: string;
  consumerName?: string;
  autoAck?: boolean;
}

export interface ChronowMessage<T = any> {
  id: string;
  topic: string;
  subscription: string;
  headers: Record<string, string>;
  payload: T;
  redeliveryCount: number;
  ack(): Promise<void>;
  nack(opts?: { requeue?: boolean; delayMs?: number }): Promise<void>;
  deadLetter(reason?: string): Promise<void>;
}

export interface TopicStats {
  topic: string;
  streamLength: number;
  consumerGroups: number;
  pendingMessages: number;
  dlqLength: number;
}

export interface PeekOptions {
  limit?: number;
  namespace?: string;
  tenantId?: string;
}

export interface ReplayOptions {
  from?: string;
  namespace?: string;
  tenantId?: string;
}

export interface MessageMetadata {
  msgId: string;
  topic: string;
  subscription: string;
  deliveryCount: number;
  firstDeliveryMs: number;
  lastDeliveryMs: number;
}

/**
 * Internal subscription state stored in Redis
 */
export interface SubscriptionState extends SubscriptionConfig {
  topic: string;
  subscription: string;
  createdAt: number;
}

