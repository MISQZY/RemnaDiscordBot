import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer, connect, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@bot/logger';
import type { ClusterManager } from 'discord-hybrid-sharding';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DynamicRuntime } from './runtime.js';
import { control } from './control.js';
import { LEASE_MS, newState, STATE_KEY, type State } from './state.js';
import { coordinationRedisOptions, readState, updateState } from './store.js';

// Run against a dedicated disposable Redis database, never a development or production URL.
const url = process.env.ORCHESTRATION_TEST_REDIS_URL;
describe.skipIf(!url)('orchestration on real Redis and OS processes', () => {
  const redis = new Redis(url ?? 'redis://127.0.0.1:6379', { ...coordinationRedisOptions(), lazyConnect: true });
  const topology = { totalShards: 1, shardsPerCluster: 1 };
  const logger = createLogger({ service: 'orchestration-test', level: 'silent', pretty: false });
  const runtimes: DynamicRuntime[] = [];
  beforeAll(async () => { await redis.connect(); });
  beforeEach(async () => { await redis.del(STATE_KEY); });
  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.stop()));
    runtimes.length = 0;
  });
  afterAll(async () => {
    await redis.del(STATE_KEY);
    redis.disconnect();
  });

  function manager(redisUrl = url) {
    const clusters = new Map();
    return {
      clusters,
      createCluster(id: number, shardList: number[]) {
        const cluster = Object.assign(new EventEmitter(), {
          shardList, ready: false, env: {} as Record<string, string>, restarts: { cleanup() {} },
          async spawn() {
            const child = fork(fileURLToPath(new URL('./cluster.fixture.ts', import.meta.url)), {
              execArgv: ['--import', 'tsx'],
              env: { ...process.env, ...cluster.env, REDIS_URL: redisUrl, TEST_CLUSTER_ID: String(id) },
              stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
            });
            child.stderr?.on('data', (data: Buffer) => process.stderr.write(data));
            child.on('message', () => { cluster.ready = true; });
            return child;
          },
        });
        clusters.set(id, cluster);
        return cluster;
      },
    } as unknown as ClusterManager;
  }

  it('serializes simultaneous writers without losing updates and keeps the key nonvolatile', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => updateState(redis, (existing, now) => {
      const state = existing ?? newState(topology, now);
      state.targets[String(index)] = `node-${index}`;
      return state;
    })));
    expect(Object.keys((await readState(redis)).state!.targets)).toHaveLength(8);
    expect(await redis.pttl(STATE_KEY)).toBe(-1);
  });

  it('scrubs legacy topology credentials on write without losing ownership', async () => {
    const state = newState(topology, Date.now());
    state.topology = { ...topology, redisUrl: 'redis://:test-secret@localhost:6379' } as typeof topology;
    state.leases['0'] = { node: 'a', session: 'session', token: 'ownership-token', expiresAt: Date.now() + LEASE_MS };
    await redis.set(STATE_KEY, JSON.stringify(state));
    await updateState(redis, (existing) => existing!);
    const stored = await readState(redis);
    expect(stored.state!.topology).toEqual(topology);
    expect(stored.raw).not.toContain('test-secret');
    expect(stored.state!.leases['0']!.token).toBe('ownership-token');
  });

  it('moves only after the old OS process exits, and guards the new child on lost ownership', async () => {
    const options = { ...topology, redisUrl: url!, memoryBytes: 1024 * 1024 * 1024, cpuCores: 2, maxClusters: 8 };
    const firstManager = manager();
    const secondManager = manager();
    const a = new DynamicRuntime(firstManager, { ...options, nodeId: 'a' }, logger);
    const b = new DynamicRuntime(secondManager, { ...options, nodeId: 'b' }, logger);
    runtimes.push(a, b);
    await updateState(redis, (_, now) => newState(topology, now - LEASE_MS));
    await a.start();
    await b.start();
    await expect.poll(() => firstManager.clusters.get(0)?.ready, { timeout: 10_000 }).toBe(true);
    await updateState(redis, (state, now) => control(state!, now, 'move', '0', 'b'));
    // The requested destination cannot acquire the old lease while its process is alive.
    expect((await readState(redis)).state!.leases['0']!.node).toBe('a');
    await expect.poll(async () => (await readState(redis)).state!.leases['0']?.node, { timeout: 20_000 }).toBe('b');
    expect(firstManager.clusters.has(0)).toBe(false);
    await expect.poll(() => secondManager.clusters.get(0)?.ready, { timeout: 10_000 }).toBe(true);
    const saved: State = (await readState(redis)).state!;
    // Simulate a revoked token. The independent child watchdog must exit before the next manager tick.
    saved.leases['0']!.token = 'revoked';
    await redis.set(STATE_KEY, JSON.stringify(saved));
    await expect.poll(() => secondManager.clusters.has(0), { timeout: 4_000 }).toBe(false);
  }, 40_000);

  it('fails over a partitioned node after its lease expires and kills its disconnected child first', async () => {
    const destination = new URL(url!);
    const sockets = new Set<Socket>();
    const proxy = createServer((socket) => {
      const upstream = connect(Number(destination.port), destination.hostname);
      sockets.add(socket);
      sockets.add(upstream);
      socket.on('error', () => undefined);
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => { sockets.delete(socket); upstream.destroy(); });
      upstream.on('close', () => sockets.delete(upstream));
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const port = (proxy.address() as { port: number }).port;
    const partitionedUrl = new URL(url!);
    partitionedUrl.hostname = '127.0.0.1';
    partitionedUrl.port = String(port);
    const options = { ...topology, memoryBytes: 1024 * 1024 * 1024, cpuCores: 2, maxClusters: 8 };
    const first = manager(partitionedUrl.href);
    const second = manager();
    const a = new DynamicRuntime(first, { ...options, redisUrl: partitionedUrl.href, nodeId: 'a' }, logger);
    const b = new DynamicRuntime(second, { ...options, redisUrl: url!, nodeId: 'b' }, logger);
    runtimes.push(a, b);
    try {
      await updateState(redis, (_, now) => newState(topology, now - LEASE_MS));
      await a.start();
      await b.start();
      await expect.poll(() => first.clusters.get(0)?.ready, { timeout: 10_000 }).toBe(true);
      const lease = (await readState(redis)).state!.leases['0']!;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await expect.poll(() => first.clusters.has(0), { timeout: LEASE_MS }).toBe(false);
      // The old lease still belongs to a even though its OS process is already gone.
      const during = await readState(redis);
      expect(during.now).toBeLessThan(lease.expiresAt);
      expect(during.state!.leases['0']!.node).toBe('a');
      await expect.poll(() => second.clusters.get(0)?.ready, { timeout: 25_000 }).toBe(true);
      expect((await readState(redis)).state!.leases['0']!.node).toBe('b');
    } finally {
      for (const socket of sockets) socket.destroy();
      if (proxy.listening) await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }, 75_000);
});
