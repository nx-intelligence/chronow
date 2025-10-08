/**
 * Configuration helper to load from environment variables
 */

import type { ChronowConfig } from '../types';

export interface EnvConfig {
  // Redis
  REDIS_URL?: string;
  REDIS_TLS?: string;
  REDIS_USERNAME?: string;
  REDIS_PASSWORD?: string;
  REDIS_DB?: string;
  REDIS_KEY_PREFIX?: string;
  REDIS_RETRY_MS?: string;
  REDIS_CLUSTER_NODES?: string;
  REDIS_CA_CERT?: string;
  
  // MongoDB
  MONGO_URI?: string;
  
  // Spaces (S3-compatible)
  SPACE_ACCESS_KEY?: string;
  SPACE_SECRET_KEY?: string;
  SPACE_ENDPOINT?: string;
  
  // Operational
  REDIS_VISIBILITY_TIMEOUT_MS?: string;
  REDIS_MAX_STREAM_LEN?: string;
  REDIS_MAX_PAYLOAD_BYTES?: string;
  
  // Mode
  CHRONOW_MONGO_ONLY?: string;
}

/**
 * Build Chronow config from environment variables
 */
export function configFromEnv(env: EnvConfig = process.env): ChronowConfig {
  const mongoOnly = env.CHRONOW_MONGO_ONLY === 'true';
  
  const config: ChronowConfig = {
    mongoOnly,
    chronos: {
      config: buildChronosConfig(env),
    },
    defaults: {
      namespace: 'default',
      tenantId: 'default',
      hotTtlSeconds: 3600,
      warmRetentionDays: 30,
      maxValueBytes: 256 * 1024,
      visibilityTimeoutMs: Number(env.REDIS_VISIBILITY_TIMEOUT_MS || 30000),
      maxDeliveries: 5,
      retryBackoffMs: [1000, 5000, 30000],
      maxStreamLen: Number(env.REDIS_MAX_STREAM_LEN || 100000),
      maxPayloadBytes: Number(env.REDIS_MAX_PAYLOAD_BYTES || 262144),
      pollIntervalMs: 1000, // For MongoDB-only mode
    },
  };

  // Only configure Redis if not in mongoOnly mode
  if (!mongoOnly && env.REDIS_URL) {
    config.redis = {
      url: env.REDIS_URL,
      tls: env.REDIS_TLS === 'true',
      username: env.REDIS_USERNAME,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB ? Number(env.REDIS_DB) : 0,
      keyPrefix: env.REDIS_KEY_PREFIX || 'cw:',
      retryMs: env.REDIS_RETRY_MS ? Number(env.REDIS_RETRY_MS) : 1000,
      clusterNodes: env.REDIS_CLUSTER_NODES ? JSON.parse(env.REDIS_CLUSTER_NODES) : undefined,
      caCertPath: env.REDIS_CA_CERT,
    };
  }

  return config;
}

/**
 * Build Chronos-DB configuration
 */
function buildChronosConfig(env: EnvConfig): any {
  const mongoUri = env.MONGO_URI || 'mongodb://localhost:27017';
  
  const config: any = {
    dbConnections: {
      'mongo-primary': {
        mongoUri,
      },
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
            dbName: 'chronos_messaging_default',
          },
        ],
      },
    },
  };

  // Add spaces configuration if provided
  if (env.SPACE_ACCESS_KEY && env.SPACE_SECRET_KEY && env.SPACE_ENDPOINT) {
    config.spacesConnections['space-primary'] = {
      accessKey: env.SPACE_ACCESS_KEY,
      secretKey: env.SPACE_SECRET_KEY,
      endpoint: env.SPACE_ENDPOINT,
    };
  }

  return config;
}

/**
 * Validate configuration
 */
export function validateConfig(config: ChronowConfig): void {
  if (!config.mongoOnly && !config.redis) {
    throw new Error(
      'Either Redis configuration must be provided or mongoOnly must be set to true'
    );
  }

  if (!config.chronos?.config) {
    throw new Error('Chronos-DB configuration is required');
  }
}

