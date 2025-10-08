# Quick Test Guide

## 🚀 Test Chronow v0.9.5 with Your Environment Variables

Since you've already added `MONGO_URI`, `SPACE_ACCESS_KEY`, `SPACE_SECRET_KEY`, and `SPACE_ENDPOINT` to your `.env` file, you can test immediately!

## Step 1: Verify Environment Variables

Check your `.env` file has:

```bash
MONGO_URI=mongodb://...
SPACE_ACCESS_KEY=...
SPACE_SECRET_KEY=...
SPACE_ENDPOINT=...
CHRONOW_MONGO_ONLY=true
```

## Step 2: Install Dependencies

```bash
cd /Users/ami/Documents/prometheus/chronow
npm install
```

This will install:
- `mongodb@^6`
- `chronos-db@^2.3.0`
- `typescript@^5`
- Development dependencies

## Step 3: Test MongoDB-only Mode

### Test A: Basic MongoDB-only Example

```bash
npx ts-node examples/mongo-only-mode.ts
```

**What this tests:**
- ✅ MongoDB connection works
- ✅ Shared memory operations
- ✅ Topic creation
- ✅ Message publishing
- ✅ Message consumption with async iterator
- ✅ Acknowledgment and stats

**Success Criteria:**
- No errors
- Sees "✓ Chronow initialized (MongoDB-only: true)"
- Processes 5 tasks successfully
- Shows topic stats

### Test B: Environment Configuration

```bash
npx ts-node examples/env-config.ts
```

**What this tests:**
- ✅ `configFromEnv()` loads your environment variables
- ✅ MongoDB-only mode detection
- ✅ End-to-end shared memory and messaging

**Success Criteria:**
- Shows "MongoDB-only mode: true"
- Shows "Redis configured: false"
- Publishes and consumes a message
- Health check passes

### Test C: Retry and DLQ (Optional)

```bash
npx ts-node examples/retry-and-dlq.ts
```

**What this tests:**
- ✅ Retry logic with backoff
- ✅ Dead-letter queue
- ✅ Max deliveries enforcement

## Step 4: Verify MongoDB Collections

After running tests, check MongoDB:

```bash
mongosh
```

```javascript
// Switch to hot tier database
use chronow_hot

// Check collections
show collections
// Should see: kv, streams, groups

// Check some data
db.kv.find().limit(5)
db.streams.find().limit(5)
db.groups.find()

// Switch to messaging database
use chronos_messaging_mongo_only

// Check warm tier collections
show collections
// Should see: shared_memory, topics, messages (if persistWarmCopy was true)

db.shared_memory.find()
db.topics.find()
```

## Step 5: Build the Library

```bash
npm run build
```

**Success Criteria:**
- No TypeScript errors
- Creates `dist/` folder with:
  - `index.js` (ESM)
  - `index.cjs` (CommonJS)
  - `index.d.ts` (TypeScript definitions)

## Step 6: Check for Issues

```bash
# Lint check
npm run lint

# TypeScript check
npx tsc --noEmit
```

Both should pass with no errors.

## 🎯 Expected Results

### Console Output from mongo-only-mode.ts

```
🚀 Starting Chronow in MongoDB-only mode

✓ Chronow initialized (MongoDB-only: true)

--- Shared Memory Example ---
Retrieved config: {
  name: 'My App',
  version: '1.0.0',
  features: [ 'feature-a', 'feature-b' ]
}

--- Messaging Example ---
✓ Topic and subscription created
✓ Published 5 tasks

--- Processing Tasks ---

Task 1: {
  id: '1728432000000-0',
  taskId: 'task-1',
  priority: 'normal'
}
✓ Task completed

Task 2: {
  id: '1728432000001-0',
  taskId: 'task-2',
  priority: 'high'
}
✓ Task completed

[... tasks 3-5 ...]

Topic stats: { topic: 'tasks', length: 0, groups: 1 }

✓ Chronow closed

💡 Note: Everything worked without Redis!
```

## 🐛 Troubleshooting

### Error: "Cannot find module 'mongodb'"

```bash
npm install mongodb@^6
```

### Error: "Connection refused" (MongoDB)

```bash
# Make sure MongoDB is running
mongod --version

# Start MongoDB if not running
brew services start mongodb-community  # macOS
# or
sudo systemctl start mongod  # Linux
```

### Error: "chronos-db not found"

chronos-db v2.3 may not exist yet. The stub adapter in `src/warm/chronosAdapter.ts` handles this gracefully. Just ensure the config structure is correct.

### TypeScript Errors

```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

## ✅ Success Checklist

- [ ] `npm install` completed without errors
- [ ] `npx ts-node examples/mongo-only-mode.ts` runs successfully
- [ ] `npx ts-node examples/env-config.ts` runs successfully
- [ ] MongoDB collections created in `chronow_hot` database
- [ ] `npm run build` creates `dist/` folder
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

## 🎉 You're Ready!

If all tests pass, Chronow v0.9.5 is working correctly with your MongoDB setup!

### Next Steps

1. **Test with your own code**: Import Chronow and try your use cases
2. **Publish to npm** (when ready):
   ```bash
   npm publish --access public
   ```
3. **Switch to Redis mode** when needed:
   ```bash
   CHRONOW_MONGO_ONLY=false
   REDIS_URL=redis://localhost:6379
   ```

## 📚 More Information

- See `README.md` for full API documentation
- See `RELEASE-0.9.5.md` for release notes
- See `IMPLEMENTATION-SUMMARY.md` for technical details
- Check `examples/` for more usage patterns

