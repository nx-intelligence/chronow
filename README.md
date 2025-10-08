# Chronow

**Redis-first (or MongoDB-only) shared memory and service-bus style topics with optional Chronos-DB durability.**

Chronow provides simple APIs for dual-tier retention, at-least-once delivery, and message queuing patterns similar to Azure Service Bus. Works with Redis for high performance, or MongoDB-only mode for development/testing.

## Features

- **Shared Memory**: Key/value storage with hot (Redis/MongoDB) + warm (Chronos-DB) tiers
- **Topics & Subscriptions**: Azure Service Bus-like messaging patterns
- **Dual Retention**: Hot TTL in Redis/MongoDB, warm retention in Chronos-DB
- **MongoDB-only Mode**: Use without Redis for development/testing (v0.9.5+)
- **At-least-once delivery**: Redis Streams or MongoDB collections + Consumer Groups
- **Retry with backoff**: Automatic redelivery with exponential backoff
- **Dead Letter Queue**: Capture failed messages for analysis
- **Multi-tenant**: Optional namespace and tenant isolation
- **TypeScript-first**: Fully typed API

## Installation

```bash
npm install chronow chronos-db mongodb
```

### With Redis (Production)
```bash
npm install chronow chronos-db mongodb ioredis
```

### MongoDB-only (Development/Testing)
```bash
npm install chronow chronos-db mongodb
```

Requires:
- Node.js 18+
- chronos-db v2.3+
- **Either** Redis 5.0+ (6.2+ recommended) **OR** MongoDB 4.4+
- ioredis (optional if using MongoDB-only mode)

## Quick Start

### Option 1: With Redis (Production)

```typescript
import { Chronow } from 'chronow';
import chronosConfig from './chronos.config.json';

const cw = await Chronow.init({
  redis: {
    url: process.env.REDIS_URL!,
    tls: process.env.REDIS_TLS === 'true',
    keyPrefix: 'cw:',
  },
  chronos: { config: chronosConfig },
});
```

### Option 2: MongoDB-only Mode (Development/Testing)

```typescript
import { Chronow } from 'chronow';

const cw = await Chronow.init({
  mongoOnly: true,  // No Redis required!
  chronos: {
    config: {
      dbConnections: {
        'mongo-primary': { mongoUri: 'mongodb://localhost:27017' }
      },
      spacesConnections: {},
      databases: {
        messaging: {
          tenantDatabases: [{
            tenantId: 'default',
            dbConnRef: 'mongo-primary',
            dbName: 'chronow_messaging'
          }]
        }
      }
    }
  },
});
```

### Option 3: Using Environment Variables

```typescript
import { Chronow, configFromEnv } from 'chronow';

// Loads from REDIS_URL, MONGO_URI, CHRONOW_MONGO_ONLY, etc.
const cw = await Chronow.init(configFromEnv());
```

### Usage (Same API for Both Modes!)

```typescript
// Shared memory
await cw.shared.set('greeting', { text: 'hello' }, {
  hotTtlSeconds: 120,
  warm: { persist: true, retentionDays: 90 }
});

const value = await cw.shared.get('greeting');
console.log(value); // { text: 'hello' }

// Topics & subscriptions
await cw.bus.ensureTopic('payments');
await cw.bus.ensureSubscription('payments', 'fraud-detector', {
  visibilityTimeoutMs: 30000,
  maxDeliveries: 5,
  retryBackoffMs: [1000, 5000, 30000],
});

// Publish
await cw.bus.publish('payments', { orderId: '123', amount: 42.5 }, {
  persistWarmCopy: true,
  headers: { type: 'payment.created' },
});

// Consume
for await (const msg of cw.bus.consume('payments', 'fraud-detector')) {
  try {
    console.log('Processing:', msg.payload);
    await processPayment(msg.payload);
    await msg.ack();
  } catch (err) {
    console.error('Failed:', err);
    await msg.nack({ requeue: true });
  }
}
```

## Environment Variables

### Mode Selection

```bash
# Set to 'true' to use MongoDB-only mode (no Redis required)
CHRONOW_MONGO_ONLY=false
```

### Redis Configuration (Optional if CHRONOW_MONGO_ONLY=true)

```bash
REDIS_URL=redis://user:pass@host:6379/0
REDIS_TLS=false
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=cw:
REDIS_RETRY_MS=1000
REDIS_CLUSTER_NODES=["host1:6379","host2:6379"]
REDIS_CA_CERT=/etc/ssl/certs/my-redis-ca.pem
```

### MongoDB Configuration (Required)

```bash
MONGO_URI=mongodb://localhost:27017
```

### Spaces/S3 Configuration (Optional)

For future large payload offload feature:

```bash
SPACE_ACCESS_KEY=your-access-key
SPACE_SECRET_KEY=your-secret-key
SPACE_ENDPOINT=https://s3.amazonaws.com
```

### Operational Tuning

```bash
REDIS_VISIBILITY_TIMEOUT_MS=30000
REDIS_MAX_STREAM_LEN=100000
REDIS_MAX_PAYLOAD_BYTES=262144
```

### Chronos-DB Configuration

Chronow expects **chronos-db v2.3+** with a `messaging` database type. Example configuration:

```json
{
  "dbConnections": {
    "mongo-primary": {
      "mongoUri": "mongodb://localhost:27017"
    }
  },
  "spacesConnections": {},
  "databases": {
    "messaging": {
      "tenantDatabases": [
        {
          "tenantId": "default",
          "dbConnRef": "mongo-primary",
          "spaceConnRef": "",
          "bucket": "",
          "dbName": "chronos_messaging_default"
        }
      ]
    }
  }
}
```

Collections are created automatically:
- `shared_memory`: Versioned key/value store
- `topics`: Topic metadata
- `messages`: Canonical message copies
- `dead_letters`: Failed messages

## API Reference

### Shared Memory

```typescript
// Set with dual persistence
await cw.shared.set(key, value, {
  namespace?: string,
  tenantId?: string,
  hotTtlSeconds?: number,
  warm?: {
    persist?: boolean,
    upsertStrategy?: 'append' | 'latest',
    retentionDays?: number,
    maxVersions?: number,
  },
  maxValueBytes?: number,
});

// Get (hot first, fallback to warm)
const value = await cw.shared.get(key, { namespace?, tenantId? });

// Delete
await cw.shared.del(key, { namespace?, tenantId?, tombstone?: boolean });

// Check existence (hot only)
const exists = await cw.shared.exists(key, { namespace?, tenantId? });

// Set TTL
await cw.shared.expire(key, ttlSeconds, { namespace?, tenantId? });
```

### Bus (Topics & Subscriptions)

```typescript
// Ensure topic exists
await cw.bus.ensureTopic(topic, { namespace?, tenantId? });

// Create subscription
await cw.bus.ensureSubscription(topic, subscription, {
  visibilityTimeoutMs?: number,
  maxDeliveries?: number,
  retryBackoffMs?: number[],
  deadLetterEnabled?: boolean,
  shardCount?: number,
});

// Publish message
const msgId = await cw.bus.publish(topic, payload, {
  persistWarmCopy?: boolean,
  headers?: Record<string, string>,
  namespace?: string,
  tenantId?: string,
});

// Publish batch
const msgIds = await cw.bus.publishBatch(topic, [
  { payload: {...}, headers: {...} },
  { payload: {...} },
]);

// Consume (async iterator)
for await (const msg of cw.bus.consume(topic, subscription, {
  namespace?,
  tenantId?,
  consumerName?,
})) {
  // msg.id, msg.topic, msg.subscription, msg.headers, msg.payload, msg.redeliveryCount
  await msg.ack();
  // or: await msg.nack({ requeue: true, delayMs?: number });
  // or: await msg.deadLetter('reason');
}

// Operations
await cw.bus.peek(topic, subscription, { limit: 10 });
await cw.bus.purge(topic);
await cw.bus.stats(topic);
await cw.bus.deleteSubscription(topic, subscription);
await cw.bus.dlqLength(topic);
await cw.bus.peekDlq(topic, 10);
await cw.bus.purgeDlq(topic);
```

## Concepts

### Dual Retention

- **Hot tier (Redis)**: In-memory with `hotTtlSeconds` TTL
- **Warm tier (Chronos-DB)**: Durable storage with `retentionDays` or version-based policies

### At-Least-Once Delivery

Uses Redis Streams + Consumer Groups:
- **Visibility timeout**: Unacked messages are auto-claimed after timeout
- **Retries**: Failed messages scheduled in ZSET for delayed requeue
- **Dead Letter Queue**: Messages exceeding `maxDeliveries` move to DLQ

### Tenancy & Namespacing

All keys are prefixed:
```
{keyPrefix}{tenantId}:{namespace}:{kind}:{name}
```

Example: `cw:tenant-a:payments:topic:orders`

## Architecture

### With Redis (Production)

```
App → Chronow API → Redis (hot) ↔ Chronos-DB (durable)
                    ├─ Shared Memory (KV/Hash)
                    └─ Streams (topic/queue)
                      └─ Retry/Delay (ZSET)
```

### MongoDB-only Mode (Development/Testing)

```
App → Chronow API → MongoDB (hot + warm)
                    ├─ Hot tier: chronow_hot database
                    └─ Warm tier: messaging database
```

**Note**: MongoDB-only mode uses collections to simulate Redis Streams. It's slower than Redis but perfect for local development and testing without additional infrastructure.

## Production Considerations

### When Using Redis (Recommended for Production)

1. **Redis Durability**: Enable AOF/RDB persistence for production
2. **Cluster/Sentinel**: Use `REDIS_CLUSTER_NODES` for HA
3. **Backpressure**: Set `REDIS_MAX_STREAM_LEN` to control memory growth
4. **DLQ Monitoring**: Poll `cw.bus.stats(topic)` and alert on DLQ growth
5. **TLS**: Set `REDIS_TLS=true` and provide `REDIS_CA_CERT` for secure connections

### When Using MongoDB-only Mode

1. **Performance**: MongoDB-only mode is slower than Redis (polling-based)
2. **Use Cases**: Best for development, testing, and low-traffic applications
3. **Indexes**: Ensure MongoDB indexes are properly created (automatic on first use)
4. **Connection Pooling**: Configure MongoDB connection pool size appropriately
5. **Upgrade Path**: Easy to switch to Redis later by just changing configuration

## Roadmap to 1.0

- [ ] Integration tests (Redis single + cluster)
- [ ] Idempotency keys for exactly-once semantics
- [ ] S3 offload for large payloads via Chronos spaces
- [ ] Prometheus metrics (publish/consume rates, lag, redeliveries)
- [ ] Admin CLI (inspect topics, move from DLQ, replay)

## License

MIT

## Contributing

Issues and PRs welcome at [github.com/nx-intelligence/chronow](https://github.com/nx-intelligence/chronow)

---

Built with ❤️ for modern distributed systems

