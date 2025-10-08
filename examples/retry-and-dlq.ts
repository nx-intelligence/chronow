/**
 * Example demonstrating retry logic and dead-letter queue
 */

import { Chronow } from '../src/index';

async function main() {
  const cw = await Chronow.init({
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      keyPrefix: 'retry-example:',
    },
    chronos: {
      config: {
        dbConnections: {
          'mongo-primary': { mongoUri: 'mongodb://localhost:27017' },
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
                dbName: 'chronos_messaging_retry_example',
              },
            ],
          },
        },
      },
    },
  });

  const topic = 'failing-tasks';
  const subscription = 'task-processor';

  // Create topic with strict retry policy
  await cw.bus.ensureTopic(topic);
  await cw.bus.ensureSubscription(topic, subscription, {
    visibilityTimeoutMs: 5000,
    maxDeliveries: 3,
    retryBackoffMs: [500, 2000, 5000],
    deadLetterEnabled: true,
  });

  console.log('✓ Topic created with retry policy');

  // Publish a message that will fail
  await cw.bus.publish(topic, {
    taskId: 'task-fail-123',
    action: 'process-payment',
    shouldFail: true,
  });

  console.log('✓ Published failing message\n');

  // Consume and simulate failures
  let attempts = 0;
  
  for await (const msg of cw.bus.consume(topic, subscription)) {
    attempts++;
    console.log(`\nAttempt ${attempts}:`, {
      id: msg.id,
      payload: msg.payload,
      redeliveryCount: msg.redeliveryCount,
    });

    if (msg.payload.shouldFail) {
      console.log('✗ Task failed, will retry...');
      await msg.nack({ requeue: true });
      
      // After max retries, message goes to DLQ automatically
      if (attempts >= 3) {
        console.log('⚠️  Max retries reached, checking DLQ...');
        
        // Wait a bit for DLQ processing
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const dlqLength = await cw.bus.dlqLength(topic);
        console.log(`\nDLQ length: ${dlqLength}`);
        
        const dlqMessages = await cw.bus.peekDlq(topic, 10);
        console.log('DLQ messages:', JSON.stringify(dlqMessages, null, 2));
        
        break;
      }
      
      // Wait a bit before next attempt
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      await msg.ack();
    }
  }

  await cw.close();
  console.log('\n✓ Example complete');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

