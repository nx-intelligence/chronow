import Redis, { Cluster } from 'ioredis';
import { readFileSync } from 'fs';

export type RedisClient = Redis | Cluster;

export interface RedisOptions {
  url?: string;
  tls?: boolean;
  username?: string;
  password?: string;
  db?: number;
  keyPrefix?: string;
  clusterNodes?: string[]; // ["host:port", ...]
  caCertPath?: string;
  retryMs?: number;
}

export function createRedis(opts: RedisOptions): RedisClient {
  if (opts.clusterNodes && opts.clusterNodes.length > 0) {
    // Redis Cluster mode
    const nodes = opts.clusterNodes.map((n) => {
      const [host, portStr] = n.split(':');
      return { host, port: Number(portStr) || 6379 };
    });

    const tlsConfig = opts.tls
      ? {
          ca: opts.caCertPath ? [readFileSync(opts.caCertPath)] : undefined,
        }
      : undefined;

    return new Cluster(nodes, {
      redisOptions: {
        username: opts.username,
        password: opts.password,
        db: opts.db,
        tls: tlsConfig,
        keyPrefix: opts.keyPrefix,
      },
      clusterRetryStrategy: () => opts.retryMs ?? 1000,
    });
  }

  // Single Redis instance
  const url = opts.url || 'redis://localhost:6379';
  const tlsConfig = opts.tls
    ? {
        ca: opts.caCertPath ? [readFileSync(opts.caCertPath)] : undefined,
      }
    : undefined;

  return new Redis(url, {
    username: opts.username,
    password: opts.password,
    db: opts.db,
    tls: tlsConfig,
    keyPrefix: opts.keyPrefix,
    retryStrategy: () => opts.retryMs ?? 1000,
  });
}

