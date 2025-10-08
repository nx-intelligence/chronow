# Chronos-DB v2.3 Requirements for Chronow

This document specifies the required extensions to **chronos-db** that Chronow depends on. These features should be implemented in chronos-db v2.3+.

## Overview

Chronow requires a new **messaging** database type in chronos-db to provide durable warm/cold tier storage for:
- Shared memory key/value pairs
- Topic metadata
- Message canonical copies
- Dead-letter messages

## 1. New Database Type: `messaging`

Add `messaging` to the list of supported database types alongside `metadata`, `knowledge`, `runtime`, and `logs`.

### Configuration Schema

```typescript
interface MessagingTenantDatabase {
  tenantId: string;
  dbConnRef: string;        // Reference to MongoDB connection
  spaceConnRef?: string;    // Optional: for future S3/space offload
  bucket?: string;          // Optional: for future S3/space offload
  dbName: string;           // MongoDB database name
}

interface ChronosConfig {
  dbConnections: { [key: string]: { mongoUri: string } };
  spacesConnections: { [key: string]: any };
  databases: {
    messaging?: {
      tenantDatabases: MessagingTenantDatabase[];
    };
    // ... other database types
  };
}
```

### Example Configuration

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
        },
        {
          "tenantId": "tenant-a",
          "dbConnRef": "mongo-primary",
          "spaceConnRef": "",
          "bucket": "",
          "dbName": "chronos_messaging_tenant_a"
        }
      ]
    }
  }
}
```

## 2. Collections and Schemas

The messaging database type should support the following collections:

### 2.1 `shared_memory`

Stores versioned key/value pairs with retention policies.

**Document Schema:**
```typescript
interface SharedMemoryDoc {
  key: string;
  namespace: string;
  tenantId: string;
  val: any;                // JSON value
  _system: {
    createdAt: Date;
    updatedAt: Date;
    retentionDays?: number;
    tombstone?: boolean;
    deletedAt?: Date;
  };
}
```

**Indexes:**
```javascript
db.shared_memory.createIndex({ key: 1, namespace: 1, tenantId: 1 }, { unique: true });
db.shared_memory.createIndex({ '_system.updatedAt': -1 });
db.shared_memory.createIndex({ '_system.deletedAt': 1 }, { sparse: true });
```

### 2.2 `topics`

Stores topic metadata.

**Document Schema:**
```typescript
interface TopicDoc {
  topic: string;
  tenantId: string;
  shards: number;
  createdAt: Date;
  _system: {
    updatedAt: Date;
  };
}
```

**Indexes:**
```javascript
db.topics.createIndex({ topic: 1, tenantId: 1 }, { unique: true });
```

### 2.3 `messages`

Stores canonical message copies for durability and audit.

**Document Schema:**
```typescript
interface MessageDoc {
  topic: string;
  msgId: string;           // Redis Stream message ID
  tenantId: string;
  headers: Record<string, string>;
  payload: any;            // JSON payload
  firstSeenAt: Date;
  size: number;            // Payload size in bytes
  _system: {
    createdAt: Date;
  };
}
```

**Indexes:**
```javascript
db.messages.createIndex({ topic: 1, msgId: 1, tenantId: 1 }, { unique: true });
db.messages.createIndex({ firstSeenAt: -1 });
db.messages.createIndex({ topic: 1, firstSeenAt: -1 });
```

### 2.4 `dead_letters`

Stores messages that failed processing after max retries.

**Document Schema:**
```typescript
interface DeadLetterDoc {
  topic: string;
  msgId: string;
  tenantId: string;
  reason: string;
  headers: Record<string, string>;
  payload: any;
  failedAt: Date;
  deliveries: number;
  _system: {
    createdAt: Date;
  };
}
```

**Indexes:**
```javascript
db.dead_letters.createIndex({ topic: 1, failedAt: -1 });
db.dead_letters.createIndex({ failedAt: -1 });
```

## 3. SDK API Methods

The chronos-db SDK should expose accessor methods for the messaging tier:

```typescript
class ChronosDB {
  /**
   * Get a handle to a messaging collection
   */
  with(params: {
    databaseType: 'messaging';
    tier: 'tenant';
    tenantId: string;
    collection: 'shared_memory' | 'topics' | 'messages' | 'dead_letters';
  }): MessagingCollection;
}

interface MessagingCollection {
  insert(doc: any): Promise<void>;
  upsert(filter: any, doc: any): Promise<void>;
  findOne(filter: any): Promise<any | null>;
  find(filter: any): Promise<any[]>;
  deleteOne(filter: any): Promise<void>;
  deleteMany(filter: any): Promise<void>;
}
```

### Example Usage

```typescript
import { ChronosDB } from 'chronos-db';

const chronos = new ChronosDB(config);

// Access shared_memory collection
const sharedMemory = chronos.with({
  databaseType: 'messaging',
  tier: 'tenant',
  tenantId: 'tenant-a',
  collection: 'shared_memory',
});

// Upsert a value
await sharedMemory.upsert(
  { key: 'user-config', namespace: 'app', tenantId: 'tenant-a' },
  {
    key: 'user-config',
    namespace: 'app',
    tenantId: 'tenant-a',
    val: { theme: 'dark' },
    _system: { createdAt: new Date(), updatedAt: new Date() },
  }
);

// Find a value
const doc = await sharedMemory.findOne({
  key: 'user-config',
  namespace: 'app',
  tenantId: 'tenant-a',
});
```

## 4. Automatic Collection Creation

When a messaging database is first accessed, chronos-db should automatically:
1. Create the database if it doesn't exist
2. Create all required collections
3. Create all required indexes

## 5. Retention Policies (Future Enhancement)

While not required for v0.9, consider adding support for:
- TTL indexes based on `_system.createdAt` or `retentionDays`
- Automatic cleanup of old documents
- Version limits per key (maxVersions)

Example:
```javascript
// Auto-expire documents after retentionDays
db.shared_memory.createIndex(
  { '_system.createdAt': 1 },
  { expireAfterSeconds: 86400 * 30 }  // 30 days
);
```

## 6. Migration Guide

For existing chronos-db installations, provide a migration script:

```javascript
// migrate-to-messaging.js
const { MongoClient } = require('mongodb');

async function migrate(config) {
  const client = await MongoClient.connect(config.dbConnections['mongo-primary'].mongoUri);
  
  for (const tenant of config.databases.messaging.tenantDatabases) {
    const db = client.db(tenant.dbName);
    
    // Create collections
    await db.createCollection('shared_memory');
    await db.createCollection('topics');
    await db.createCollection('messages');
    await db.createCollection('dead_letters');
    
    // Create indexes
    await db.collection('shared_memory').createIndex(
      { key: 1, namespace: 1, tenantId: 1 },
      { unique: true }
    );
    // ... etc
  }
  
  await client.close();
}
```

## 7. Testing

Provide tests for:
- Database and collection creation
- Index creation
- CRUD operations on all collections
- Multi-tenancy isolation
- Concurrent access

## 8. Documentation

Update chronos-db documentation to include:
- Messaging database type overview
- Configuration examples
- API reference for messaging collections
- Schema documentation
- Migration guide

## Notes

- This is a **new database type**, not a modification of existing types
- Should be backward compatible with existing chronos-db installations
- Can be implemented incrementally (start with basic CRUD, add features later)
- Consider using MongoDB transactions for multi-document operations
- Should support both MongoDB replica sets and standalone instances

