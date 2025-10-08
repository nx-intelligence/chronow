/**
 * Basic usage example for Chronow
 */

import { Chronow } from '../src/index';

async function main() {
  // Initialize Chronow
  const cw = await Chronow.init({
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      keyPrefix: 'example:',
    },
    chronos: {
      config: {
        dbConnections: {
          'mongo-primary': {
            mongoUri: 'mongodb://localhost:27017',
          },
        },
        spacesConnections: {},
        databases: {
          messaging: {
            tenantDatabases: [
              {
                tenantId: 'default',
                dbConnRef: 'mongo-primary',
                spaceConnRef: '',
                bucket: '',
                dbName: 'chronos_messaging_example',
              },
            ],
          },
        },
      },
    },
    defaults: {
      namespace: 'example',
      tenantId: 'tenant-1',
      hotTtlSeconds: 300,
      warmRetentionDays: 7,
    },
  });

  console.log('✓ Chronow initialized');

  // Example 1: Shared Memory
  console.log('\n--- Shared Memory Example ---');
  
  await cw.shared.set('user-config', {
    theme: 'dark',
    language: 'en',
    notifications: true,
  }, {
    hotTtlSeconds: 600,
    warm: {
      persist: true,
      upsertStrategy: 'latest',
      retentionDays: 30,
    },
  });
  
  const config = await cw.shared.get('user-config');
  console.log('User config:', config);

  // Example 2: Topic & Subscription
  console.log('\n--- Messaging Example ---');
  
  const topic = 'orders';
  const subscription = 'order-processor';

  await cw.bus.ensureTopic(topic);
  await cw.bus.ensureSubscription(topic, subscription, {
    visibilityTimeoutMs: 30000,
    maxDeliveries: 3,
    retryBackoffMs: [1000, 5000, 15000],
    deadLetterEnabled: true,
  });

  console.log('✓ Topic and subscription created');

  // Publish messages
  const msgId1 = await cw.bus.publish(topic, {
    orderId: 'ord-123',
    items: ['item-1', 'item-2'],
    total: 99.99,
  }, {
    persistWarmCopy: true,
    headers: {
      type: 'order.created',
      source: 'web-app',
    },
  });

  console.log('✓ Published message:', msgId1);

  // Batch publish
  const msgIds = await cw.bus.publishBatch(topic, [
    {
      payload: { orderId: 'ord-124', total: 49.99 },
      headers: { type: 'order.created' },
    },
    {
      payload: { orderId: 'ord-125', total: 149.99 },
      headers: { type: 'order.created' },
    },
  ], { persistWarmCopy: true });

  console.log('✓ Published batch:', msgIds.length, 'messages');

  // Consume messages
  console.log('\n--- Consuming Messages ---');
  let count = 0;
  const maxMessages = 3;

  for await (const msg of cw.bus.consume(topic, subscription)) {
    console.log(`\nMessage ${count + 1}:`, {
      id: msg.id,
      payload: msg.payload,
      headers: msg.headers,
      redeliveryCount: msg.redeliveryCount,
    });

    // Process message
    try {
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await msg.ack();
      console.log('✓ Acknowledged');
      
      count++;
      if (count >= maxMessages) {
        break;
      }
    } catch (err) {
      console.error('✗ Processing failed:', err);
      await msg.nack({ requeue: true });
    }
  }

  // Get stats
  const stats = await cw.bus.stats(topic);
  console.log('\nTopic stats:', stats);

  // Cleanup
  await cw.close();
  console.log('\n✓ Chronow closed');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

