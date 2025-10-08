/**
 * MongoDB adapter that provides Redis-like interface for MongoDB-only mode
 * This allows Chronow to work without Redis for development/testing
 */

import { MongoClient, Db, Collection } from 'mongodb';

export interface MongoAdapterOptions {
  mongoUri: string;
  dbName?: string;
  keyPrefix?: string;
}

/**
 * MongoDB adapter that mimics Redis interface
 * Used when Redis is not available (mongoOnly mode)
 */
export class MongoAdapter {
  private client: MongoClient;
  private db!: Db;
  private kvCollection!: Collection;
  private streamsCollection!: Collection;
  private groupsCollection!: Collection;
  private keyPrefix: string;
  public status: string = 'disconnected';

  constructor(private options: MongoAdapterOptions) {
    this.client = new MongoClient(options.mongoUri);
    this.keyPrefix = options.keyPrefix || 'cw:';
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.options.dbName || 'chronow_hot');
    
    // Collections for Redis-like operations
    this.kvCollection = this.db.collection('kv');
    this.streamsCollection = this.db.collection('streams');
    this.groupsCollection = this.db.collection('groups');
    
    // Create indexes
    await this.kvCollection.createIndex({ key: 1 }, { unique: true });
    await this.kvCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.streamsCollection.createIndex({ stream: 1, id: 1 });
    await this.streamsCollection.createIndex({ stream: 1, 'group': 1, 'consumer': 1 });
    await this.groupsCollection.createIndex({ stream: 1, group: 1 }, { unique: true });
    
    this.status = 'ready';
  }

  // Emit events for compatibility
  once(event: string, handler: (err?: Error) => void): void {
    if (event === 'ready' && this.status === 'ready') {
      handler();
    } else if (event === 'error') {
      // No-op for now
    }
  }

  async ping(): Promise<string> {
    await this.db.admin().ping();
    return 'PONG';
  }

  disconnect(): void {
    this.client.close();
  }

  pipeline(): any {
    // Return a mock pipeline that queues operations
    const ops: Array<() => Promise<any>> = [];
    return {
      set: (...args: any[]) => { ops.push(() => this.set(...args)); return this; },
      get: (...args: any[]) => { ops.push(() => this.get(...args)); return this; },
      del: (...args: any[]) => { ops.push(() => this.del(...args)); return this; },
      xadd: (...args: any[]) => { ops.push(() => this.xadd(...args)); return this; },
      exec: async () => {
        const results = [];
        for (const op of ops) {
          try {
            results.push([null, await op()]);
          } catch (err) {
            results.push([err, null]);
          }
        }
        return results;
      },
    };
  }

  // Key-value operations
  async set(key: string, value: Buffer | string, ...args: any[]): Promise<string> {
    const fullKey = this.keyPrefix + key;
    let expiresAt: Date | undefined;
    
    // Parse TTL arguments (EX, seconds)
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'EX' && args[i + 1]) {
        const seconds = Number(args[i + 1]);
        expiresAt = new Date(Date.now() + seconds * 1000);
        break;
      }
    }

    await this.kvCollection.updateOne(
      { key: fullKey },
      {
        $set: {
          key: fullKey,
          value: value instanceof Buffer ? value.toString('base64') : value,
          isBuffer: value instanceof Buffer,
          expiresAt,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const fullKey = this.keyPrefix + key;
    const doc = await this.kvCollection.findOne({ key: fullKey });
    if (!doc) return null;
    return doc.isBuffer ? Buffer.from(doc.value, 'base64').toString() : doc.value;
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const fullKey = this.keyPrefix + key;
    const doc = await this.kvCollection.findOne({ key: fullKey });
    if (!doc) return null;
    return doc.isBuffer ? Buffer.from(doc.value, 'base64') : Buffer.from(doc.value);
  }

  async del(...keys: string[]): Promise<number> {
    const fullKeys = keys.map(k => this.keyPrefix + k);
    const result = await this.kvCollection.deleteMany({ key: { $in: fullKeys } });
    return result.deletedCount || 0;
  }

  async exists(...keys: string[]): Promise<number> {
    const fullKeys = keys.map(k => this.keyPrefix + k);
    return await this.kvCollection.countDocuments({ key: { $in: fullKeys } });
  }

  async expire(key: string, seconds: number): Promise<number> {
    const fullKey = this.keyPrefix + key;
    const expiresAt = new Date(Date.now() + seconds * 1000);
    const result = await this.kvCollection.updateOne(
      { key: fullKey },
      { $set: { expiresAt } }
    );
    return result.matchedCount;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    const fullKey = this.keyPrefix + key;
    await this.kvCollection.updateOne(
      { key: fullKey },
      {
        $set: {
          key: fullKey,
          type: 'hash',
          [`fields.${field}`]: value,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return 1;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const fullKey = this.keyPrefix + key;
    const doc = await this.kvCollection.findOne({ key: fullKey, type: 'hash' });
    return doc?.fields?.[field] || null;
  }

  // Stream operations
  async xadd(stream: string, ...args: any[]): Promise<string> {
    const fullStream = this.keyPrefix + stream;
    let maxlen: number | undefined;
    let fieldsStart = 0;

    // Parse MAXLEN argument
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'MAXLEN' && args[i + 2]) {
        maxlen = Number(args[i + 2]);
        fieldsStart = i + 3;
        break;
      }
      if (args[i] === '*') {
        fieldsStart = i + 1;
        break;
      }
    }

    // Generate message ID (timestamp-sequence)
    const now = Date.now();
    const count = await this.streamsCollection.countDocuments({
      stream: fullStream,
      timestamp: now,
    });
    const msgId = `${now}-${count}`;

    // Parse fields
    const fields: any = {};
    for (let i = fieldsStart; i < args.length; i += 2) {
      fields[args[i]] = args[i + 1];
    }

    await this.streamsCollection.insertOne({
      stream: fullStream,
      id: msgId,
      timestamp: now,
      sequence: count,
      fields,
      createdAt: new Date(),
      pending: [],
    });

    // Trim if maxlen specified
    if (maxlen) {
      const count = await this.streamsCollection.countDocuments({ stream: fullStream });
      if (count > maxlen) {
        const toDelete = count - maxlen;
        const oldDocs = await this.streamsCollection
          .find({ stream: fullStream })
          .sort({ timestamp: 1, sequence: 1 })
          .limit(toDelete)
          .toArray();
        
        await this.streamsCollection.deleteMany({
          _id: { $in: oldDocs.map(d => d._id) },
        });
      }
    }

    return msgId;
  }

  async xgroup(command: string, ...args: any[]): Promise<any> {
    const [stream, group] = args;
    const fullStream = this.keyPrefix + stream;

    if (command === 'CREATE') {
      try {
        await this.groupsCollection.insertOne({
          stream: fullStream,
          group,
          lastId: args[2] || '0-0',
          createdAt: new Date(),
        });
        return 'OK';
      } catch (err: any) {
        if (err.code === 11000) {
          throw new Error('BUSYGROUP Consumer Group name already exists');
        }
        throw err;
      }
    } else if (command === 'DESTROY') {
      await this.groupsCollection.deleteOne({ stream: fullStream, group });
      return 1;
    }
    
    return 'OK';
  }

  async xreadgroup(...args: any[]): Promise<any> {
    // Parse: GROUP groupname consumer BLOCK ms COUNT n STREAMS stream >
    let groupIdx = args.indexOf('GROUP');
    let blockIdx = args.indexOf('BLOCK');
    let countIdx = args.indexOf('COUNT');
    let streamsIdx = args.indexOf('STREAMS');

    const group = args[groupIdx + 1];
    const consumer = args[groupIdx + 2];
    const blockMs = blockIdx >= 0 ? Number(args[blockIdx + 1]) : 0;
    const count = countIdx >= 0 ? Number(args[countIdx + 1]) : 10;
    const stream = this.keyPrefix + args[streamsIdx + 1];
    const startId = args[streamsIdx + 2];

    // Get messages not yet delivered to this group
    const query: any = { stream };
    if (startId === '>') {
      query[`pending.${group}`] = { $exists: false };
    }

    const messages = await this.streamsCollection
      .find(query)
      .sort({ timestamp: 1, sequence: 1 })
      .limit(count)
      .toArray();

    if (messages.length === 0 && blockMs > 0) {
      // Simple blocking: wait and retry once
      await new Promise(resolve => setTimeout(resolve, Math.min(blockMs, 1000)));
      const retry = await this.streamsCollection
        .find(query)
        .sort({ timestamp: 1, sequence: 1 })
        .limit(count)
        .toArray();
      
      if (retry.length === 0) return null;
      
      // Mark as pending
      for (const msg of retry) {
        await this.streamsCollection.updateOne(
          { _id: msg._id },
          { $set: { [`pending.${group}.${consumer}`]: new Date() } }
        );
      }
      
      return [[stream, retry.map(m => [m.id, Object.entries(m.fields).flat()])]];
    }

    if (messages.length === 0) return null;

    // Mark as pending for this consumer group
    for (const msg of messages) {
      await this.streamsCollection.updateOne(
        { _id: msg._id },
        { $set: { [`pending.${group}.${consumer}`]: new Date() } }
      );
    }

    return [[stream, messages.map(m => [m.id, Object.entries(m.fields).flat()])]];
  }

  async xack(stream: string, group: string, ...ids: string[]): Promise<number> {
    const fullStream = this.keyPrefix + stream;
    
    for (const id of ids) {
      await this.streamsCollection.updateOne(
        { stream: fullStream, id },
        { $unset: { [`pending.${group}`]: '' } }
      );
    }
    
    return ids.length;
  }

  async xlen(stream: string): Promise<number> {
    const fullStream = this.keyPrefix + stream;
    return await this.streamsCollection.countDocuments({ stream: fullStream });
  }

  async xrange(stream: string, start: string, end: string, ...args: any[]): Promise<any[]> {
    const fullStream = this.keyPrefix + stream;
    let limit = 10;
    
    const countIdx = args.indexOf('COUNT');
    if (countIdx >= 0) {
      limit = Number(args[countIdx + 1]);
    }

    const messages = await this.streamsCollection
      .find({ stream: fullStream })
      .sort({ timestamp: 1, sequence: 1 })
      .limit(limit)
      .toArray();

    return messages.map(m => [m.id, Object.entries(m.fields).flat()]);
  }

  async xinfo(command: string, stream: string): Promise<any[]> {
    const fullStream = this.keyPrefix + stream;
    
    if (command === 'STREAM') {
      const count = await this.streamsCollection.countDocuments({ stream: fullStream });
      const groups = await this.groupsCollection.countDocuments({ stream: fullStream });
      
      return ['length', count, 'groups', groups];
    }
    
    return [];
  }

  async xpending(stream: string, group: string, start: string, end: string, count: number): Promise<any[]> {
    const fullStream = this.keyPrefix + stream;
    
    const messages = await this.streamsCollection
      .find({
        stream: fullStream,
        [`pending.${group}`]: { $exists: true },
      })
      .limit(count)
      .toArray();

    return messages.map(m => {
      const pendingTime = m.pending[group];
      const idleMs = Date.now() - new Date(Object.values(pendingTime)[0] as any).getTime();
      return [m.id, Object.keys(pendingTime)[0], idleMs, 1];
    });
  }

  async xclaim(stream: string, group: string, consumer: string, minIdleTime: number, ...ids: string[]): Promise<any[]> {
    const fullStream = this.keyPrefix + stream;
    
    const messages = [];
    for (const id of ids) {
      const result = await this.streamsCollection.findOneAndUpdate(
        { stream: fullStream, id },
        { $set: { [`pending.${group}.${consumer}`]: new Date() } },
        { returnDocument: 'after' }
      );
      
      if (result) {
        messages.push([result.id, Object.entries(result.fields).flat()]);
      }
    }
    
    return messages;
  }

  async xautoclaim(stream: string, group: string, consumer: string, minIdleTime: number, start: string, ...args: any[]): Promise<any> {
    const fullStream = this.keyPrefix + stream;
    let count = 10;
    
    const countIdx = args.indexOf('COUNT');
    if (countIdx >= 0) {
      count = Number(args[countIdx + 1]);
    }

    const cutoff = new Date(Date.now() - minIdleTime);
    
    const messages = await this.streamsCollection
      .find({
        stream: fullStream,
        [`pending.${group}`]: { $exists: true, $lt: cutoff },
      })
      .limit(count)
      .toArray();

    for (const msg of messages) {
      await this.streamsCollection.updateOne(
        { _id: msg._id },
        { $set: { [`pending.${group}.${consumer}`]: new Date() } }
      );
    }

    return ['0-0', messages.map(m => [m.id, Object.entries(m.fields).flat()])];
  }

  // Sorted set operations (for retry queue)
  async zadd(key: string, score: number, member: string): Promise<number> {
    const fullKey = this.keyPrefix + key;
    
    await this.kvCollection.updateOne(
      { key: fullKey, type: 'zset' },
      {
        $set: {
          key: fullKey,
          type: 'zset',
          [`members.${member}`]: score,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    return 1;
  }

  async zrangebyscore(key: string, min: string, max: string, ...args: any[]): Promise<string[]> {
    const fullKey = this.keyPrefix + key;
    const doc = await this.kvCollection.findOne({ key: fullKey, type: 'zset' });
    
    if (!doc || !doc.members) return [];
    
    const minScore = min === '-inf' ? -Infinity : Number(min);
    const maxScore = max === '+inf' ? Infinity : Number(max);
    
    let limit = 100;
    const limitIdx = args.indexOf('LIMIT');
    if (limitIdx >= 0) {
      limit = Number(args[limitIdx + 2]);
    }
    
    const members = Object.entries(doc.members)
      .filter(([, score]) => (score as number) >= minScore && (score as number) <= maxScore)
      .sort(([, a], [, b]) => (a as number) - (b as number))
      .slice(0, limit)
      .map(([member]) => member);
    
    return members;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const fullKey = this.keyPrefix + key;
    
    const unset: any = {};
    for (const member of members) {
      unset[`members.${member}`] = '';
    }
    
    const result = await this.kvCollection.updateOne(
      { key: fullKey, type: 'zset' },
      { $unset: unset }
    );
    
    return result.modifiedCount;
  }

  async zcard(key: string): Promise<number> {
    const fullKey = this.keyPrefix + key;
    const doc = await this.kvCollection.findOne({ key: fullKey, type: 'zset' });
    
    if (!doc || !doc.members) return 0;
    return Object.keys(doc.members).length;
  }
}

