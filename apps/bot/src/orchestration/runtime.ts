import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { availableParallelism, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { ClusterHeartbeat } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { Logger } from '@bot/logger';
import type { Cluster, ClusterManager } from 'discord-hybrid-sharding';
import { Redis } from 'ioredis';
import { assertTopology, newState, reportNode, SAFETY_MS, shardsFor, TICK_MS, type ClusterLoad, type State, type Topology } from './state.js';
import { coordinationRedisOptions, updateState } from './store.js';

export interface DynamicOptions extends Topology {
  nodeId: string;
  redisUrl: string;
  memoryBytes: number;
  cpuCores: number;
  maxClusters: number;
}

interface Running {
  cluster: Cluster;
  child: ChildProcess;
  token: string;
  startedAt: number;
  unhealthySince?: number;
  watchdog?: NodeJS.Timeout;
  stopping?: Promise<void>;
}

/** Starts and stops individual global cluster ids; ClusterManager's local respawn is disabled. */
export class DynamicRuntime {
  readonly session = randomUUID();
  private readonly redis: Redis;
  private readonly running = new Map<string, Running>();
  private readonly blocked: Record<string, number> = {};
  private readonly failures = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = false;
  private lastSuccess = 0;
  private connected = false;
  private previousTargets = '';

  constructor(private readonly manager: ClusterManager, private readonly options: DynamicOptions, private readonly logger: Logger) {
    this.redis = new Redis(options.redisUrl, { ...coordinationRedisOptions(), lazyConnect: true });
    this.redis.on('error', (err) => logger.warn({ err }, 'Coordination Redis unavailable'));
  }

  get healthy(): boolean {
    return this.connected && performance.now() - this.lastSuccess < TICK_MS * 3;
  }

  async start(): Promise<void> {
    await this.redis.connect();
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
  }

  private async sample(): Promise<Record<string, ClusterLoad>> {
    const entries = [...this.running.entries()];
    if (!entries.length) return {};
    const values = await this.redis.mget(...entries.map(([id]) => RedisKeys.clusterHeartbeat(Number(id))));
    const samples: Record<string, ClusterLoad> = {};
    for (const [index, [id, running]] of entries.entries()) {
      const raw = values[index];
      let heartbeat: ReturnType<typeof ClusterHeartbeat.safeParse> | undefined;
      try { heartbeat = raw ? ClusterHeartbeat.safeParse(JSON.parse(raw)) : undefined; } catch { /* Ignore malformed monitoring data. */ }
      const data = heartbeat?.success ? heartbeat.data : undefined;
      const fresh = data?.nodeId === this.options.nodeId && Date.parse(data.updatedAt) >= running.startedAt && Date.now() - Date.parse(data.updatedAt) < (data.heartbeatTtlMs ?? 90_000);
      samples[id] = {
        memoryBytes: fresh ? data.memoryBytes ?? 128 * 1024 * 1024 : 128 * 1024 * 1024,
        cpuCores: fresh ? data.cpuCores ?? 0.1 : 0.1,
        eventLoopDelayMs: fresh ? data.eventLoopDelayMs ?? 0 : 0,
        eventsPerSecond: fresh ? data.eventsPerSecond ?? 0 : 0,
        ready: fresh && data.ready && running.cluster.ready,
      };
      if (samples[id]!.ready) {
        this.failures.delete(id);
        running.unhealthySince = undefined;
      } else {
        running.unhealthySince ??= Date.now();
      }
      if (running.unhealthySince !== undefined && Date.now() - running.unhealthySince > 180_000 && !running.stopping) {
        this.blocked[id] = Date.now() + 60_000;
        this.logger.warn({ clusterId: id }, 'Cluster remained unhealthy; requesting reassignment');
        void this.stopCluster(id, running);
      }
    }
    return samples;
  }

  private async tick(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const started = performance.now();
    try {
      const samples = await this.sample();
      const next = await updateState(this.redis, (existing, now) => {
        if (this.stopped) throw new Error('Manager is stopping');
        const state = existing ?? newState(this.options, now);
        assertTopology(state, this.options);
        // Local cooldowns are durations; Redis's clock is authoritative for ownership.
        const blocked = Object.fromEntries(Object.entries(this.blocked).filter(([, until]) => until > Date.now()).map(([id, until]) => [id, now + until - Date.now()]));
        reportNode(state, this.options.nodeId, {
          session: this.session, seenAt: now, joinedAt: now,
          maxClusters: this.options.maxClusters,
          memoryBytes: this.options.memoryBytes, cpuCores: this.options.cpuCores,
          overheadBytes: process.memoryUsage().rss,
          hostPressure: (loadavg()[0] ?? 0) / availableParallelism() / 0.9,
          clusters: samples, blocked,
        }, now);
        return state;
      });
      if (this.stopped) return;
      this.lastSuccess = performance.now();
      this.connected = true;
      const targets = JSON.stringify(next.targets);
      if (targets !== this.previousTargets) {
        this.previousTargets = targets;
        this.logger.info({ targets: next.targets }, 'Cluster assignments updated');
        const count = Math.ceil(this.options.totalShards / this.options.shardsPerCluster);
        const node = next.nodes[this.options.nodeId]!;
        if (Object.keys(next.targets).length < count && node.seenAt - node.joinedAt > 60_000) {
          this.logger.warn({ assigned: Object.keys(next.targets).length, total: count }, 'Some clusters have no destination; check node resource budgets');
        }
      }
      await this.reconcile(next, started);
    } catch (err) {
      this.logger.error({ err, node: this.options.nodeId }, 'Orchestration tick failed; existing leases will expire');
    } finally {
      this.busy = false;
    }
  }

  private async reconcile(state: State, started: number): Promise<void> {
    for (const [id, running] of this.running) {
      const lease = state.leases[id];
      if (!lease || lease.token !== running.token || state.targets[id] !== this.options.nodeId || state.drained.includes(this.options.nodeId)) {
        void this.stopCluster(id, running);
      }
    }
    for (const [id, lease] of Object.entries(state.leases)) {
      if (this.stopped || lease.node !== this.options.nodeId || lease.session !== this.session || state.targets[id] !== this.options.nodeId) continue;
      // The lease was granted during this request, so this deadline is conservative even with clock skew.
      const deadline = started + lease.expiresAt - state.nodes[this.options.nodeId]!.seenAt - SAFETY_MS;
      const remaining = deadline - performance.now();
      if (remaining <= 0) continue;
      let running = this.running.get(id);
      if (running?.stopping) continue;
      if (running && running.token !== lease.token) { void this.stopCluster(id, running); continue; }
      if (!running) {
        const cluster = this.manager.createCluster(Number(id), shardsFor(Number(id), this.options), this.options.totalShards);
        cluster.env.SHARD_LEASE_TOKEN = lease.token;
        cluster.env.SHARD_NODE_ID = this.options.nodeId;
        cluster.on('error', (err: unknown) => this.logger.error({ err, clusterId: id }, 'Cluster process error'));
        try {
          const child = await cluster.spawn(-1) as ChildProcess;
          running = { cluster, child, token: lease.token, startedAt: Date.now() };
          this.running.set(id, running);
          const entry = running;
          child.once('exit', () => {
            clearTimeout(entry.watchdog);
            if (this.running.get(id) !== entry || entry.stopping) return;
            this.running.delete(id);
            this.manager.clusters.delete(Number(id));
            const failures = (this.failures.get(id) ?? 0) + 1;
            this.failures.set(id, failures);
            this.blocked[id] = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(failures, 6));
          });
          this.logger.info({ clusterId: id, node: this.options.nodeId, shards: cluster.shardList }, 'Assigned cluster started');
        } catch (err) {
          // A failed spawn must not leave an untracked process with a valid ownership token.
          this.logger.error({ err, clusterId: id }, 'Assigned cluster failed to spawn');
          this.blocked[id] = Date.now() + 60_000;
          const child = cluster.thread?.process as ChildProcess | undefined;
          if (child) {
            const failed = { cluster, child, token: lease.token, startedAt: Date.now() };
            this.running.set(id, failed);
            void this.stopCluster(id, failed);
          } else {
            this.manager.clusters.delete(Number(id));
          }
          continue;
        }
      }
      clearTimeout(running.watchdog);
      const entry = running;
      running.watchdog = setTimeout(() => { void this.stopCluster(id, entry); }, Math.max(0, deadline - performance.now()));
    }
  }

  private stopCluster(id: string, running: Running): Promise<void> {
    if (running.stopping) return running.stopping;
    running.stopping = this.terminate(id, running);
    return running.stopping;
  }

  private async terminate(id: string, running: Running): Promise<void> {
    clearTimeout(running.watchdog);
    // Listen for the actual OS exit. Cluster.kill() removes process listeners before termination.
    if (running.child.exitCode === null && running.child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => running.child.kill('SIGKILL'), 5_000);
        running.child.once('exit', () => { clearTimeout(force); resolve(); });
        running.child.kill('SIGTERM');
      });
    }
    running.cluster.restarts.cleanup();
    if (this.running.get(id) === running) {
      this.running.delete(id);
      this.manager.clusters.delete(Number(id));
    }
    this.logger.info({ clusterId: id }, 'Assigned cluster stopped');
    try {
      await updateState(this.redis, (state) => {
        if (!state) throw new Error('Orchestration state missing during release');
        if (state.leases[id]?.token === running.token) delete state.leases[id];
        return state;
      });
    } catch (err) {
      this.logger.warn({ err, clusterId: id }, 'Lease release failed; waiting for expiry');
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await Promise.all([...this.running].map(([id, running]) => this.stopCluster(id, running)));
    // Do not remove a replacement manager's registration.
    try {
      await updateState(this.redis, (state) => {
        if (!state) throw new Error('Orchestration state missing during shutdown');
        if (state.nodes[this.options.nodeId]?.session === this.session) delete state.nodes[this.options.nodeId];
        if (state.leader?.session === this.session) delete state.leader;
        return state;
      });
    } catch (err) {
      this.logger.warn({ err }, 'Manager registration cleanup failed; waiting for expiry');
    } finally {
      this.redis.disconnect();
    }
  }
}
