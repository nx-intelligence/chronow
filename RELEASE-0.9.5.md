# Chronow v0.9.5 Release Notes

## 🎉 Major Update: MongoDB-only Mode

Version 0.9.5 introduces a **MongoDB-only mode** that allows Chronow to work without Redis. Perfect for development, testing, and environments where Redis is not available.

## What's New

### 1. MongoDB-only Mode

Run Chronow without Redis by setting `mongoOnly: true`:

```typescript
const cw = await Chronow.init({
  mongoOnly: true,
  chronos: {
    config: {
      dbConnections: {
        'mongo-primary': { mongoUri: process.env.MONGO_URI }
      },
      // ... rest of config
    }
  }
});
```

**The API remains exactly the same** - switch modes by configuration only!

### 2. Environment Variable Configuration

New `configFromEnv()` helper loads configuration from environment variables:

```typescript
import { Chronow, configFromEnv } from 'chronow';

const cw = await Chronow.init(configFromEnv());
```

Supports:
- `CHRONOW_MONGO_ONLY` - Enable MongoDB-only mode
- `MONGO_URI` - MongoDB connection string
- `SPACE_ACCESS_KEY`, `SPACE_SECRET_KEY`, `SPACE_ENDPOINT` - S3-compatible storage
- All existing Redis environment variables

### 3. MongoAdapter

New internal adapter that provides Redis-like interface using MongoDB:
- Implements Redis commands (SET, GET, XADD, XREADGROUP, ZADD, etc.)
- Automatic index creation
- TTL support via MongoDB TTL indexes
- Consumer groups and pending message tracking

## Testing Instructions

### Prerequisites

Ensure you have these values in your `.env` file:

```bash
MONGO_URI=mongodb://localhost:27017
SPACE_ACCESS_KEY=your-access-key
SPACE_SECRET_KEY=your-secret-key
SPACE_ENDPOINT=https://your-s3-endpoint.com
```

### Test 1: MongoDB-only Mode

```bash
# Copy env.example to .env and set:
CHRONOW_MONGO_ONLY=true
MONGO_URI=mongodb://localhost:27017

# Run the example
npx ts-node examples/mongo-only-mode.ts
```

Expected output:
- ✓ Chronow initialized in MongoDB-only mode
- ✓ Shared memory operations work
- ✓ Topic creation and messaging work
- ✓ Consumer processing works
- No Redis connection errors

### Test 2: Environment Configuration

```bash
# Ensure .env has valid values
# Run the example
npx ts-node examples/env-config.ts
```

Expected output:
- ✓ Configuration loaded from environment
- ✓ Shows current mode (MongoDB-only or Redis+MongoDB)
- ✓ Shared memory and messaging operations work

### Test 3: Redis Mode (if Redis available)

```bash
# In .env, set:
CHRONOW_MONGO_ONLY=false
REDIS_URL=redis://localhost:6379

# Run basic example
npx ts-node examples/basic-usage.ts
```

Expected output:
- ✓ Chronow initialized with Redis
- ✓ All operations work as before

## Migration Guide

### From 0.9.0 to 0.9.5

No breaking changes! Existing code continues to work. 

#### Optional: Add MongoDB-only support

1. Add MongoDB dependency (if not already present):
   ```bash
   npm install mongodb@^6
   ```

2. Configure environment variables:
   ```bash
   MONGO_URI=mongodb://localhost:27017
   CHRONOW_MONGO_ONLY=true  # For MongoDB-only mode
   ```

3. Use `configFromEnv()` for easier configuration:
   ```typescript
   import { Chronow, configFromEnv } from 'chronow';
   const cw = await Chronow.init(configFromEnv());
   ```

## Architecture Changes

### Redis Mode (Production - Unchanged)
```
App → Chronow → Redis (hot) ↔ Chronos-DB (warm)
```

### MongoDB-only Mode (New - Development/Testing)
```
App → Chronow → MongoDB (hot: chronow_hot) ↔ MongoDB (warm: messaging)
```

## Performance Considerations

- **Redis Mode**: High performance, uses native Redis Streams
- **MongoDB-only Mode**: Lower performance, uses polling and collections
  - Suitable for: Development, testing, low-traffic applications
  - Not recommended for: High-throughput production workloads

## Files Changed/Added

### New Files
- `src/core/config.ts` - Environment variable configuration helper
- `src/core/mongoAdapter.ts` - MongoDB adapter for Redis-like operations
- `examples/mongo-only-mode.ts` - MongoDB-only mode example
- `examples/env-config.ts` - Environment configuration example

### Modified Files
- `package.json` - Version bump to 0.9.5, added MongoDB dependency
- `src/index.ts` - Support for MongoDB-only mode
- `src/types.ts` - Optional Redis configuration
- `README.md` - MongoDB-only mode documentation
- `CHANGELOG.md` - Release notes
- `env.example` - New environment variables

## Known Limitations

1. **MongoDB-only mode is slower** - Uses polling instead of pub/sub
2. **Auto-claim timing** - May differ slightly from Redis XAUTOCLAIM
3. **No built-in expiry** - TTL relies on MongoDB TTL indexes (background process)

## Next Steps

- Run all three test scenarios above
- Verify MongoDB collections are created:
  - `chronow_hot.kv`
  - `chronow_hot.streams`
  - `chronow_hot.groups`
  - `chronos_messaging_default.shared_memory`
  - `chronos_messaging_default.messages`

## Upgrade

```bash
npm install chronow@0.9.5 mongodb@^6
```

## Questions?

See the updated README.md or open an issue on GitHub.

---

**Happy coding! 🚀**

