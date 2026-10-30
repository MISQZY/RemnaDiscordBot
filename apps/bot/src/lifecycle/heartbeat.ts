import type { ClusterHeartbeat } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { Logger } from '@bot/logger';
import { Status, type Client } from 'discord.js';
import type { Redis } from 'ioredis';

export interface HeartbeatOptions {
  clusterId: number;
  shards: number[];
  intervalMs?: number;
}

export function buildHeartbeat(client: Client, { clusterId, shards }: HeartbeatOptions): ClusterHeartbeat {
  const counts = new Map<number, { guilds: number; members: number }>();
  for (const guild of client.guilds.cache.values()) {
    const count = counts.get(guild.shardId) ?? { guilds: 0, members: 0 };
    count.guilds++;
    count.members += guild.memberCount;
    counts.set(guild.shardId, count);
  }
  const states = {
    [Status.Ready]: 'ready',
    [Status.Connecting]: 'connecting',
    [Status.Reconnecting]: 'reconnecting',
    [Status.Idle]: 'idle',
    [Status.Nearly]: 'nearly',
    [Status.Disconnected]: 'disconnected',
    [Status.WaitingForGuilds]: 'waitingForGuilds',
    [Status.Identifying]: 'identifying',
    [Status.Resuming]: 'resuming',
  } as const;
  return {
    clusterId,
    shards,
    guilds: client.guilds.cache.size,
    ping: Number.isFinite(client.ws.ping) ? Math.round(client.ws.ping) : -1,
    ready: client.isReady(),
    updatedAt: new Date().toISOString(),
    totalShards: client.options.shardCount,
    uptime: client.uptime ?? 0,
    memoryBytes: process.memoryUsage().rss,
    shardStats: shards.map((shardId) => {
      const shard = client.ws.shards.get(shardId);
      return {
        shardId,
        status: shard ? states[shard.status] : 'disconnected',
        ping: shard && Number.isFinite(shard.ping) ? Math.round(shard.ping) : -1,
        ...(counts.get(shardId) ?? { guilds: 0, members: 0 }),
      };
    }),
  };
}

/**
 * Periodically writes the cluster state to Redis. The TTL is three times the interval:
 * a missing key means the cluster is not responding.
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
