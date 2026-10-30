import { createLogger } from '@bot/logger';
import { createTestRedis } from '@bot/testing';
import { Collection, Status, type Client } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { buildHeartbeat, startHeartbeat } from './heartbeat.js';

const client = {
  guilds: { cache: new Collection(Array.from({ length: 7 }, (_, i) => [String(i), { shardId: i % 2 + 6, memberCount: 10 }])) },
  ws: { ping: 42.4, shards: new Collection([[6, { status: Status.Ready, ping: 40.2 }], [7, { status: Status.Reconnecting, ping: -1 }]]) },
  options: { shardCount: 8 },
  uptime: 120_000,
  isReady: () => true,
} as unknown as Client;

describe('startHeartbeat', () => {
  it('reports each assigned shard and counts members independently of the member cache', () => {
    expect(buildHeartbeat(client, { clusterId: 3, shards: [6, 7, 8] })).toMatchObject({
      totalShards: 8,
      uptime: 120_000,
      memoryBytes: expect.any(Number),
      shardStats: [
        { shardId: 6, status: 'ready', ping: 40, guilds: 4, members: 40 },
        { shardId: 7, status: 'reconnecting', ping: -1, guilds: 3, members: 30 },
        { shardId: 8, status: 'disconnected', ping: -1, guilds: 0, members: 0 },
      ],
    });
  });
  it('writes the cluster state with a TTL and removes it on stop', async () => {
    const redis = createTestRedis();
    const stop = startHeartbeat(client, redis, createLogger({ service: 'test', level: 'silent', pretty: false }), {
      clusterId: 3,
      shards: [6, 7],
      intervalMs: 1_000,
    });

    await expect.poll(() => redis.get('bot:cluster:3')).not.toBeNull();
    expect(JSON.parse((await redis.get('bot:cluster:3'))!)).toMatchObject({
      clusterId: 3,
      shards: [6, 7],
      guilds: 7,
      ping: 42,
      ready: true,
    });
    expect(await redis.pttl('bot:cluster:3')).toBeGreaterThan(2_000);

    await stop();
    expect(await redis.get('bot:cluster:3')).toBeNull();
  });
});
