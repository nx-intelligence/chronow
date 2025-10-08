/**
 * Example: Using Chronow with environment variable configuration
 * This shows how to easily switch between Redis and MongoDB-only modes
 */

import { Chronow, configFromEnv } from '../src/index';

async function main() {
  console.log('🚀 Starting Chronow with environment configuration\n');

  // Load configuration from environment variables
  // See .env.example for all available options
  const config = configFromEnv();

  console.log('Configuration loaded:');
  console.log('- MongoDB-only mode:', config.mongoOnly);
  console.log('- Redis configured:', !!config.redis);
  console.log('');

  // Initialize Chronow
  const cw = await Chronow.init(config);

  console.log(`✓ Chronow initialized (MongoDB-only: ${cw.isMongoOnly})\n`);

  // Test shared memory
  await cw.shared.set('test-key', { 
    message: 'Hello from env config!',
    mode: cw.isMongoOnly ? 'MongoDB-only' : 'Redis + MongoDB',
    timestamp: new Date().toISOString(),
  }, {
    hotTtlSeconds: 60,
    warm: { persist: true },
  });

  const value = await cw.shared.get('test-key');
  console.log('Stored and retrieved:', value);

  // Test messaging
  const topic = 'env-test';
  await cw.bus.ensureTopic(topic);
  await cw.bus.ensureSubscription(topic, 'test-sub');

  const msgId = await cw.bus.publish(topic, {
    test: 'environment configuration',
    mode: cw.isMongoOnly ? 'MongoDB-only' : 'Redis + MongoDB',
  });

  console.log('\n✓ Published message:', msgId);

  // Consume one message
  for await (const msg of cw.bus.consume(topic, 'test-sub')) {
    console.log('✓ Consumed message:', msg.payload);
    await msg.ack();
    break;
  }

  // Health check
  const healthy = await cw.ping();
  console.log('\n✓ Health check:', healthy ? 'PASS' : 'FAIL');

  await cw.close();
  console.log('\n✓ Chronow closed');
  
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

