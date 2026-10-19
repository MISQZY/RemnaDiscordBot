import { createLogger } from '@bot/logger';
import { createTestRedis } from '@bot/testing';
import type { Client } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { startHeartbeat } from './heartbeat.js';

const client = {
  guilds: { cache: { size: 7 } },
  ws: { ping: 42.4 },
  isReady: () => true,
} as unknown as Client;

describe('startHeartbeat', () => {
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
