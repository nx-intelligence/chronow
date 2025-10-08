/**
 * Build a namespaced Redis key
 * Pattern: {keyPrefix}{tenantId}:{namespace}:{kind}:{name}
 * kind ∈ {sm, topic, sub, retry, dlq}
 */
export interface KeyParams {
  tenantId: string;
  namespace: string;
  kind: 'sm' | 'topic' | 'sub' | 'retry' | 'dlq';
  name: string;
}

export function buildKey(params: KeyParams, keyPrefix: string = ''): string {
  return `${keyPrefix}${params.tenantId}:${params.namespace}:${params.kind}:${params.name}`;
}

/**
 * Build topic stream key
 */
export function buildTopicKey(topic: string, tenantId: string, namespace: string, keyPrefix: string = ''): string {
  return buildKey({ tenantId, namespace, kind: 'topic', name: topic }, keyPrefix);
}

/**
 * Build subscription consumer group name
 */
export function buildConsumerGroup(subscription: string): string {
  return `sub:${subscription}`;
}

/**
 * Build retry ZSET key for a subscription
 */
export function buildRetryKey(topic: string, subscription: string, tenantId: string, namespace: string, keyPrefix: string = ''): string {
  return buildKey({ tenantId, namespace, kind: 'retry', name: `${topic}:${subscription}` }, keyPrefix);
}

/**
 * Build DLQ stream key for a topic
 */
export function buildDlqKey(topic: string, tenantId: string, namespace: string, keyPrefix: string = ''): string {
  return buildKey({ tenantId, namespace, kind: 'dlq', name: topic }, keyPrefix);
}

