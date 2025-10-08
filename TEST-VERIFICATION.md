# Chronow v0.9.5 - Redis Optional Verification

## 🎯 Core Feature: Redis is OPTIONAL

**v0.9.5's main feature**: The same code works with Redis OR MongoDB-only mode - **just change the configuration**.

## ✅ Verification Tests

### Test 1: MongoDB-only Mode (NO Redis)

```typescript
import { Chronow } from 'chronow';

// Configuration with NO Redis - MongoDB only
const cw = await Chronow.init({
  mongoOnly: true,  // ← The magic flag
  chronos: {
    config: {
      dbConnections: {
        'mongo-primary': { mongoUri: process.env.MONGO_URI }
      },
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
  }
});

// Same exact API!
await cw.shared.set('key', { value: 'test' });
const data = await cw.shared.get('key');
```

**Expected**: ✅ Works perfectly without Redis installed

### Test 2: Redis Mode (Traditional)

```typescript
import { Chronow } from 'chronow';

// Configuration WITH Redis
const cw = await Chronow.init({
  redis: {
    url: 'redis://localhost:6379'
  },
  chronos: {
    config: { /* same chronos config */ }
  }
});

// SAME EXACT API!
await cw.shared.set('key', { value: 'test' });
const data = await cw.shared.get('key');
```

**Expected**: ✅ Works with Redis for high performance

### Test 3: Environment Variable Switch

**MongoDB-only mode** (`.env`):
```bash
CHRONOW_MONGO_ONLY=true
MONGO_URI=mongodb://localhost:27017
```

**Redis mode** (`.env`):
```bash
CHRONOW_MONGO_ONLY=false
REDIS_URL=redis://localhost:6379
MONGO_URI=mongodb://localhost:27017
```

**Same code for both**:
```typescript
import { Chronow, configFromEnv } from 'chronow';

const cw = await Chronow.init(configFromEnv());

// This code works IDENTICALLY in both modes!
await cw.shared.set('key', { value: 'test' });
await cw.bus.publish('topic', { data: 'message' });
```

## 🔍 What Changes Between Modes?

### Configuration (Only This Changes!)
- MongoDB-only: `mongoOnly: true`
- Redis mode: `redis: { url: '...' }`

### Code (THIS STAYS THE SAME!)
- ✅ `cw.shared.set()` - Identical
- ✅ `cw.shared.get()` - Identical  
- ✅ `cw.bus.publish()` - Identical
- ✅ `cw.bus.consume()` - Identical
- ✅ `msg.ack()` / `msg.nack()` - Identical
- ✅ All APIs - Identical

## 📊 Architecture Comparison

### Mode 1: With Redis (Production)
```
App Code (unchanged)
    ↓
Chronow API (unchanged)
    ↓
Redis (hot tier) ←→ Chronos-DB (persistence)
```

### Mode 2: MongoDB-only (Development/Testing)
```
App Code (unchanged)
    ↓
Chronow API (unchanged)
    ↓
MongoDB (hot tier via MongoAdapter) ←→ Chronos-DB (persistence)
```

## ✨ Key Points

1. **Same TypeScript API** - No code changes needed
2. **Same method signatures** - All types identical
3. **Same behavior** - At-least-once delivery, retry, DLQ all work
4. **Different backends** - Redis (fast) or MongoDB (convenient)
5. **Easy switching** - Just configuration change

## 🎯 Use Cases

### MongoDB-only Mode Perfect For:
- ✅ Local development (no Redis to install)
- ✅ CI/CD testing
- ✅ Proof-of-concepts
- ✅ Low-traffic applications
- ✅ When you already have MongoDB

### Redis Mode Perfect For:
- ✅ Production (high performance)
- ✅ High-throughput messaging
- ✅ Low-latency requirements
- ✅ Real-time applications

## 🧪 Quick Verification

Run this to prove it works without Redis:

```bash
# Ensure MongoDB is running (no Redis needed!)
# Set environment
export CHRONOW_MONGO_ONLY=true
export MONGO_URI=mongodb://localhost:27017

# Run example
npx ts-node examples/mongo-only-mode.ts
```

**Expected output**:
```
✓ Chronow initialized (MongoDB-only: true)
✓ Shared memory operations work
✓ Topic and subscription created
✓ Published 5 tasks
✓ All tasks processed
💡 Note: Everything worked without Redis!
```

## 📝 Summary

**v0.9.5 Achievement**: 
- ✅ Redis is now **OPTIONAL**
- ✅ Same API works with Redis OR MongoDB
- ✅ **Zero code changes** - only configuration
- ✅ Easy migration path (start with MongoDB, upgrade to Redis later)

This is the **key differentiator** of Chronow v0.9.5!

