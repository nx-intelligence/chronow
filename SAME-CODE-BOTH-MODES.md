# The Same Code Works in BOTH Modes! 🎯

## This is the core feature of Chronow v0.9.5

### Your Application Code (NEVER CHANGES!)

```typescript
// app.ts - This exact code works in BOTH modes!

import { Chronow } from 'chronow';

// Your business logic
async function processOrders(cw: Chronow) {
  // Shared memory - works identically in both modes
  await cw.shared.set('config', { 
    maxRetries: 3,
    timeout: 5000 
  }, {
    hotTtlSeconds: 300,
    warm: { persist: true }
  });

  // Messaging - works identically in both modes
  await cw.bus.ensureTopic('orders');
  await cw.bus.ensureSubscription('orders', 'processor', {
    maxDeliveries: 3,
    visibilityTimeoutMs: 30000,
  });

  // Publish - works identically in both modes
  await cw.bus.publish('orders', {
    orderId: '123',
    items: ['item1', 'item2']
  }, { persistWarmCopy: true });

  // Consume - works identically in both modes
  for await (const msg of cw.bus.consume('orders', 'processor')) {
    console.log('Processing order:', msg.payload);
    await msg.ack();
  }
}

// This function NEVER changes!
```

---

## What Changes? ONLY Configuration!

### Mode 1: Development/Testing (MongoDB-only)

**config-dev.ts**
```typescript
import { Chronow } from 'chronow';

const cw = await Chronow.init({
  mongoOnly: true,  // ← Only this!
  chronos: {
    config: {
      dbConnections: {
        'mongo-primary': { 
          mongoUri: 'mongodb://localhost:27017' 
        }
      },
      databases: {
        messaging: {
          tenantDatabases: [{
            tenantId: 'default',
            dbConnRef: 'mongo-primary',
            dbName: 'chronow_dev'
          }]
        }
      }
    }
  }
});

// Call your business logic - same code!
await processOrders(cw);
```

### Mode 2: Production (Redis)

**config-prod.ts**
```typescript
import { Chronow } from 'chronow';

const cw = await Chronow.init({
  redis: {  // ← Only this!
    url: 'redis://prod-redis:6379',
    tls: true,
  },
  chronos: {
    config: {
      dbConnections: {
        'mongo-primary': { 
          mongoUri: 'mongodb://prod-mongo:27017' 
        }
      },
      databases: {
        messaging: {
          tenantDatabases: [{
            tenantId: 'default',
            dbConnRef: 'mongo-primary',
            dbName: 'chronow_prod'
          }]
        }
      }
    }
  }
});

// Call your business logic - SAME CODE!
await processOrders(cw);
```

---

## Even Easier: Environment Variables

**Your code (NEVER changes)**:
```typescript
import { Chronow, configFromEnv } from 'chronow';

const cw = await Chronow.init(configFromEnv());

// Your business logic - works in BOTH modes
await processOrders(cw);
```

**.env.development**
```bash
CHRONOW_MONGO_ONLY=true
MONGO_URI=mongodb://localhost:27017
```

**.env.production**
```bash
CHRONOW_MONGO_ONLY=false
REDIS_URL=redis://prod-redis:6379
REDIS_TLS=true
MONGO_URI=mongodb://prod-mongo:27017
```

**Switch modes**: Just change `.env` file!

---

## Benefits

### ✅ Developer Experience
- **No Redis to install locally** - just use MongoDB
- **Same code in dev and prod** - no surprises
- **Easy testing** - CI/CD without Redis infrastructure
- **Gradual migration** - start with MongoDB, add Redis later

### ✅ Production Flexibility  
- **Use Redis** when you need high performance
- **Use MongoDB-only** for simpler deployments
- **Mix environments** - dev uses MongoDB, prod uses Redis
- **Zero refactoring** - upgrade by changing config only

---

## Real-World Scenario

```typescript
// Your service code (write once, run anywhere!)
class OrderService {
  constructor(private chronow: Chronow) {}

  async createOrder(data: any) {
    // Cache user preferences - works in both modes
    await this.chronow.shared.set(`user:${data.userId}`, data.preferences);
    
    // Publish event - works in both modes
    await this.chronow.bus.publish('orders', data);
  }

  async processOrders() {
    // Consume events - works in both modes
    for await (const msg of this.chronow.bus.consume('orders', 'processor')) {
      await this.handleOrder(msg.payload);
      await msg.ack();
    }
  }
}

// Initialization differs by environment
// Development:
const devChronow = await Chronow.init({ mongoOnly: true, ... });
const devService = new OrderService(devChronow);

// Production:
const prodChronow = await Chronow.init({ redis: {...}, ... });
const prodService = new OrderService(prodChronow);

// But OrderService code is IDENTICAL!
```

---

## Summary

| Aspect | Changes? |
|--------|----------|
| **Your business logic** | ❌ Never changes |
| **API calls** | ❌ Never changes |
| **Type signatures** | ❌ Never changes |
| **Error handling** | ❌ Never changes |
| **Configuration** | ✅ Only this changes |

**This is Chronow v0.9.5's superpower**: Write once, deploy anywhere!

