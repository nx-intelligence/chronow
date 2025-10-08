/**
 * Example: Using Chronow in MongoDB-only mode (without Redis)
 * Perfect for development, testing, or when Redis is not available
 */

import { Chronow, configFromEnv } from '../src/index';

async function main() {
  console.log('🚀 Starting Chronow in MongoDB-only mode\n');

  // Option 1: Use environment variables
  // Set CHRONOW_MONGO_ONLY=true and MONGO_URI in .env
  // const config = configFromEnv();

  // Option 2: Manual configuration
  const cw = await Chronow.init({
    mongoOnly: true, // Enable MongoDB-only mode
    chronos: {
      config: {
        dbConnections: {
          'mongo-primary': {
            mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017',
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
                dbName: 'chronow_messaging_mongo_only',
              },
            ],
          },
        },
      },
    },
    defaults: {
      namespace: 'mongo-example',
      tenantId: 'tenant-1',
    },
  });

  console.log(`✓ Chronow initialized (MongoDB-only: ${cw.isMongoOnly})\n`);

  // Example 1: Shared Memory (works exactly the same!)
  console.log('--- Shared Memory Example ---');
  
  await cw.shared.set('app-config', {
    name: 'My App',
    version: '1.0.0',
    features: ['feature-a', 'feature-b'],
  }, {
    hotTtlSeconds: 300,
    warm: {
      persist: true,
      retentionDays: 30,
    },
  });

  const config = await cw.shared.get('app-config');
  console.log('Retrieved config:', config);

  // Example 2: Messaging (works exactly the same!)
  console.log('\n--- Messaging Example ---');

  const topic = 'tasks';
  const subscription = 'worker';

  await cw.bus.ensureTopic(topic);
  await cw.bus.ensureSubscription(topic, subscription, {
    visibilityTimeoutMs: 10000,
    maxDeliveries: 3,
    retryBackoffMs: [500, 2000, 5000],
  });

  console.log('✓ Topic and subscription created');

  // Publish some tasks
  for (let i = 1; i <= 5; i++) {
    await cw.bus.publish(topic, {
      taskId: `task-${i}`,
      action: 'process',
      data: { value: i * 100 },
    }, {
      persistWarmCopy: true,
      headers: {
        priority: i % 2 === 0 ? 'high' : 'normal',
      },
    });
  }

  console.log('✓ Published 5 tasks\n');

  // Consume tasks
  console.log('--- Processing Tasks ---');
  let processed = 0;
  const maxTasks = 5;

  for await (const msg of cw.bus.consume(topic, subscription)) {
    console.log(`\nTask ${processed + 1}:`, {
      id: msg.id,
      taskId: msg.payload.taskId,
      priority: msg.headers.priority,
    });

    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 100));

    await msg.ack();
    console.log('✓ Task completed');

    processed++;
    if (processed >= maxTasks) {
      break;
    }
  }

  // Get stats
  const stats = await cw.bus.stats(topic);
  console.log('\nTopic stats:', stats);

  // Cleanup
  await cw.close();
  console.log('\n✓ Chronow closed');
  console.log('\n💡 Note: Everything worked without Redis!');
  
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

