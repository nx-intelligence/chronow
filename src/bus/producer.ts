import type { RedisClient } from '../core/redis';
import { buildTopicKey } from '../core/keys';
import { toFlatArray, hashValue } from '../core/codecs';
import { ChronosWarm } from '../warm/chronosAdapter';
import type { PublishOptions } from './types';

export interface ProducerDefaults {
  namespace: string;
  tenantId: string;
  keyPrefix: string;
  maxStreamLen: number;
  maxPayloadBytes: number;
}

export class Producer {
  constructor(
    private redis: RedisClient,
    private warm: ChronosWarm,
    private defaults: ProducerDefaults
  ) {}

  /**
   * Publish a message to a topic
   */
  async publish(
    topic: string,
    payload: any,
    opts: PublishOptions = {}
  ): Promise<string> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const headers = opts.headers ?? {};
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    // Validate payload size
    const payloadStr = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(payloadStr, 'utf-8');
    if (payloadBytes > this.defaults.maxPayloadBytes) {
      throw new Error(
        `Payload exceeds max size: ${payloadBytes} > ${this.defaults.maxPayloadBytes} bytes`
      );
    }

    // Build stream entry
    const entry = {
      payload: payloadStr,
      headers: JSON.stringify(headers),
      hash: hashValue(payload),
      size: payloadBytes.toString(),
      publishedAt: new Date().toISOString(),
    };

    // Add to Redis Stream with MAXLEN
    const msgId = await this.redis.xadd(
      topicKey,
      'MAXLEN',
      '~',
      this.defaults.maxStreamLen.toString(),
      '*',
      ...toFlatArray(entry)
    );

    // Optionally persist warm copy to Chronos-DB
    if (opts.persistWarmCopy) {
      await this.warm.saveMessage(topic, msgId, payload, headers, { tenantId });
    }

    return msgId;
  }

  /**
   * Publish multiple messages in a pipeline for better performance
   */
  async publishBatch(
    topic: string,
    messages: Array<{ payload: any; headers?: Record<string, string> }>,
    opts: Omit<PublishOptions, 'headers'> = {}
  ): Promise<string[]> {
    const namespace = opts.namespace ?? this.defaults.namespace;
    const tenantId = opts.tenantId ?? this.defaults.tenantId;
    const topicKey = buildTopicKey(topic, tenantId, namespace, this.defaults.keyPrefix);

    const pipeline = this.redis.pipeline();
    const warmSaves: Promise<void>[] = [];

    for (const msg of messages) {
      const headers = msg.headers ?? {};
      const payloadStr = JSON.stringify(msg.payload);
      const payloadBytes = Buffer.byteLength(payloadStr, 'utf-8');

      if (payloadBytes > this.defaults.maxPayloadBytes) {
        throw new Error(
          `Payload exceeds max size: ${payloadBytes} > ${this.defaults.maxPayloadBytes} bytes`
        );
      }

      const entry = {
        payload: payloadStr,
        headers: JSON.stringify(headers),
        hash: hashValue(msg.payload),
        size: payloadBytes.toString(),
        publishedAt: new Date().toISOString(),
      };

      pipeline.xadd(
        topicKey,
        'MAXLEN',
        '~',
        this.defaults.maxStreamLen.toString(),
        '*',
        ...toFlatArray(entry)
      );

      // Persist warm copy if requested (do this after pipeline)
      if (opts.persistWarmCopy) {
        // We'll need to get the msgId after execution
        warmSaves.push(
          this.warm.saveMessage(topic, '', msg.payload, headers, { tenantId })
        );
      }
    }

    const results = await pipeline.exec();
    const msgIds = results?.map(([err, id]) => {
      if (err) throw err;
      return id as string;
    }) ?? [];

    // Execute warm saves
    if (opts.persistWarmCopy) {
      await Promise.all(warmSaves);
    }

    return msgIds;
  }
}

