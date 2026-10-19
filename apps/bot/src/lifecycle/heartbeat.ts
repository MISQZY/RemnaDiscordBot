import type { ClusterHeartbeat } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { Logger } from '@bot/logger';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';

export interface HeartbeatOptions {
  clusterId: number;
  shards: number[];
  intervalMs?: number;
}

export function buildHeartbeat(client: Client, { clusterId, shards }: HeartbeatOptions): ClusterHeartbeat {
  return {
    clusterId,
    shards,
    guilds: client.guilds.cache.size,
    ping: Math.round(client.ws.ping),
    ready: client.isReady(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Периодически пишет состояние кластера в Redis. TTL втрое больше интервала:
 * пропавший ключ означает, что кластер не отвечает.
 */
export function startHeartbeat(client: Client, redis: Redis, logger: Logger, options: HeartbeatOptions): () => Promise<void> {
  const intervalMs = options.intervalMs ?? 30_000;
  const key = RedisKeys.clusterHeartbeat(options.clusterId);

  const beat = () =>
    redis
      .set(key, JSON.stringify(buildHeartbeat(client, options)), 'PX', intervalMs * 3)
      .catch((err: unknown) => logger.warn({ err }, 'Heartbeat failed'));

  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref();

  return async () => {
    clearInterval(timer);
    await redis.del(key).catch(() => undefined);
  };
}
