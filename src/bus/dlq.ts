import type { RedisClient } from '../core/redis';
import { buildDlqKey } from '../core/keys';
import { toFlatArray } from '../core/codecs';
import { ChronosWarm } from '../warm/chronosAdapter';

export interface DlqManagerDefaults {
  namespace: string;
  tenantId: string;
  keyPrefix: string;
  maxStreamLen: number;
}

export interface DeadLetterOptions {
  namespace?: string;
  tenantId?: string;
}

export class DlqManager {
  constructor(
    private redis: RedisClient,
    private warm: ChronosWarm,
    private defaults: DlqManagerDefaults
  ) {}

  /**
   * Send a message to the dead-letter queue
   */
  async sendToDeadLetter(
    topic: string,
    msgId: string,
    payload: any,
    headers: Record<string, string>,
    reason: string,
    deliveries: number,
    opts: DeadLetterOptions = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const dlqKey = buildDlqKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    // Add to DLQ stream
    const entry = {
      originalMsgId: msgId,
      payload: JSON.stringify(payload),
      headers: JSON.stringify(headers),
      reason,
      deliveries: deliveries.toString(),
      failedAt: new Date().toISOString(),
    };

    await this.redis.xadd(
      dlqKey,
      'MAXLEN',
      '~',
      this.defaults.maxStreamLen.toString(),
      '*',
      ...toFlatArray(entry)
    );

    // Persist to Chronos-DB
    await this.warm.saveDeadLetter(
      topic,
      msgId,
      reason,
      payload,
      headers,
      deliveries,
      { tenantId }
    );
  }

  /**
   * Get dead-letter queue length
   */
  async getDlqLength(
    topic: string,
    opts: DeadLetterOptions = {}
  ): Promise<number> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const dlqKey = buildDlqKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    try {
      return await this.redis.xlen(dlqKey);
    } catch {
      return 0;
    }
  }

  /**
   * Peek at DLQ messages
   */
  async peekDlq(
    topic: string,
    limit: number = 10,
    opts: DeadLetterOptions = {}
  ): Promise<any[]> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const dlqKey = buildDlqKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    try {
      const entries = await this.redis.xrange(dlqKey, '-', '+', 'COUNT', limit);
      return entries.map(([id, fields]: [string, string[]]) => {
        const obj: any = { id };
        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          let val = fields[i + 1];
          // Try parse JSON fields
          if (key === 'payload' || key === 'headers') {
            try {
              val = JSON.parse(val);
            } catch {
              // keep as string
            }
          }
          obj[key] = val;
        }
        return obj;
      });
    } catch {
      return [];
    }
  }

  /**
   * Purge dead-letter queue
   */
  async purgeDlq(
    topic: string,
    opts: DeadLetterOptions = {}
  ): Promise<void> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const dlqKey = buildDlqKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    await this.redis.del(dlqKey);
  }
}

