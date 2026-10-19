import { BotStatus, ClusterHeartbeat } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { ApiDeps } from '../deps.js';

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== '0');
  return keys;
}

/** Bot cluster state from their heartbeats in Redis; a missing cluster simply drops out of the list. */
export function statusRoutes({ redis }: ApiDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/v1/status',
      { schema: { tags: ['status'], summary: 'Bot cluster status', security: [], response: { 200: BotStatus } } },
      async () => {
        const keys = await scanKeys(redis, RedisKeys.clusterHeartbeatPattern);
        const values = keys.length > 0 ? await redis.mget(...keys) : [];
        const clusters = values
          .map((raw) => (raw ? ClusterHeartbeat.safeParse(JSON.parse(raw)) : null))
          .filter((parsed) => parsed?.success)
          .map((parsed) => parsed!.data!)
          .sort((a, b) => a.clusterId - b.clusterId);
        return { clusters };
      },
    );
  };
}
