import type { ClusterHeartbeat } from '@bot/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/app.js';

const heartbeat = (clusterId: number): ClusterHeartbeat => ({
  clusterId,
  shards: [clusterId * 2, clusterId * 2 + 1],
  guilds: 10 * clusterId,
  ping: 40,
  ready: true,
  updatedAt: new Date().toISOString(),
});

describe('status route', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('is empty when no cluster reports', async () => {
    expect((await t.app.inject('/v1/status')).json()).toEqual({ clusters: [] });
  });

  it('lists cluster heartbeats ordered by id and skips malformed ones', async () => {
    await t.redis.set('bot:cluster:1', JSON.stringify(heartbeat(1)));
    await t.redis.set('bot:cluster:0', JSON.stringify(heartbeat(0)));
    await t.redis.set('bot:cluster:9', JSON.stringify({ broken: true }));

    const { clusters } = (await t.app.inject('/v1/status')).json();

    expect(clusters.map((c: ClusterHeartbeat) => c.clusterId)).toEqual([0, 1]);
    expect(clusters[1]).toMatchObject({ shards: [2, 3], guilds: 10, ready: true });
  });
});
