# Changelog

All notable changes to Chronow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.5] - 2025-10-08

### Added

- **MongoDB-only Mode**: Can now run Chronow without Redis for development/testing
  - Set `mongoOnly: true` in config or `CHRONOW_MONGO_ONLY=true` in environment
  - Uses MongoDB collections to simulate Redis Streams
  - Same API regardless of mode - switch by configuration only
  
- **Environment Variable Configuration**: New `configFromEnv()` helper
  - Loads configuration from environment variables
  - Supports `MONGO_URI`, `SPACE_ACCESS_KEY`, `SPACE_SECRET_KEY`, `SPACE_ENDPOINT`
  - Easy switching between Redis and MongoDB-only modes

- **MongoAdapter**: New adapter that provides Redis-like interface using MongoDB
  - Implements Redis commands (XADD, XREADGROUP, ZADD, etc.) using MongoDB
  - Automatic index creation
  - TTL support via MongoDB TTL indexes

- **New Examples**:
  - `mongo-only-mode.ts`: Demonstrates MongoDB-only usage
  - `env-config.ts`: Shows environment variable configuration

### Changed

- Made Redis optional in `ChronowConfig`
- Made `ioredis` a peer dependency (optional if using MongoDB-only mode)
- Updated README with MongoDB-only mode documentation

### Dependencies

- Added `mongodb` ^6 as a dependency
- Made `ioredis` optional peer dependency

## [0.9.0] - 2025-10-08

### Added

- **Shared Memory**: Dual-tier key/value storage with Redis (hot) and Chronos-DB (warm)
  - `set()`, `get()`, `del()`, `exists()`, `expire()` methods
  - Configurable TTL and retention policies
  - Optional warm persistence with upsert strategies

- **Bus/Messaging**: Azure Service Bus-like topics and subscriptions
  - Topic and subscription management
  - At-least-once delivery with consumer groups
  - Async iterator-based consumption pattern
  - Message acknowledgment (`ack()`, `nack()`, `deadLetter()`)

- **Retry Logic**: Exponential backoff retry mechanism
  - Configurable retry backoff intervals
  - Automatic retry scheduling using Redis Sorted Sets
  - Delivery count tracking

- **Dead Letter Queue**: Capture and persist failed messages
  - Automatic DLQ transfer after max deliveries
  - DLQ inspection and management APIs
  - Warm persistence of dead letters to Chronos-DB

- **Multi-tenancy**: Namespace and tenant isolation
  - Configurable tenant IDs
  - Namespace-based logical grouping
  - Automatic key prefixing

- **Chronos-DB Integration**: Durable warm/cold tier
  - Messaging database type support
  - Collections: `shared_memory`, `topics`, `messages`, `dead_letters`
  - Configurable retention policies

- **Redis Support**:
  - Single instance and cluster mode
  - TLS/SSL support
  - Custom CA certificates
  - Connection retry logic

### Infrastructure

- Full TypeScript implementation with strict typing
- ESM and CommonJS dual module support
- Comprehensive README and documentation
- Example files demonstrating basic usage and retry/DLQ patterns
- MIT License

### Dependencies

- ioredis ^5
- chronos-db ^2.3.0

## [Unreleased]

### Planned for v1.0

- Integration tests
- Idempotency keys for exactly-once semantics
- S3 offload for large payloads
- Prometheus metrics
- Admin CLI tool
- Message replay functionality
- Performance optimizations

