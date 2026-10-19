import { metricsSnapshot, renderMetrics } from '@bot/core';
import type { Logger } from '@bot/logger';
import type { ClusterManager } from 'discord-hybrid-sharding';
import type { Client } from 'discord.js';
import { AggregatorRegistry, Gauge, collectDefaultMetrics } from 'prom-client';

type Snapshot = Awaited<ReturnType<typeof metricsSnapshot>>;

const CLUSTER_TIMEOUT_MS = 5_000;

/** Cluster gauges read from the client on every scrape; the manager fetches them with `metricsSnapshot`. */
export function registerClusterMetrics(client: Client, clusterId: number): void {
  collectDefaultMetrics({ labels: { cluster: String(clusterId) } });
  new Gauge({
    name: 'bot_guilds',
    help: 'Guilds served by the cluster',
    labelNames: ['cluster'] as const,
    collect() {
      this.set({ cluster: String(clusterId) }, client.guilds.cache.size);
    },
  });
  new Gauge({
    name: 'bot_shard_ping_seconds',
    help: 'Gateway heartbeat latency of the shard; -1 while it has none',
    labelNames: ['shard'] as const,
    collect() {
      for (const shard of client.ws.shards.values()) {
        this.set({ shard: String(shard.id) }, shard.ping < 0 ? -1 : shard.ping / 1000);
      }
    },
  });
  client.metricsSnapshot = metricsSnapshot;
}

/** Manager gauges: whether each cluster is up, the manager sees it before Redis heartbeats expire. */
export function registerManagerMetrics(manager: ClusterManager): void {
  collectDefaultMetrics({ labels: { cluster: 'manager' } });
  new Gauge({
    name: 'bot_cluster_up',
    help: 'Whether the cluster process is alive and ready',
    labelNames: ['cluster'] as const,
    collect() {
      for (const cluster of manager.clusters.values()) this.set({ cluster: String(cluster.id) }, cluster.ready ? 1 : 0);
    },
  });
}

/** The manager's metrics merged with every reachable cluster's; a cluster that does not answer is skipped. */
export async function aggregateMetrics(manager: ClusterManager, logger: Logger): Promise<string> {
  const results = await Promise.allSettled(
    // Evaluated in the cluster with `this` bound to its client.
    [...manager.clusters.values()].map((cluster) => cluster.eval('this.metricsSnapshot()', undefined, CLUSTER_TIMEOUT_MS) as Promise<Snapshot>),
  );
  const snapshots: Snapshot[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') snapshots.push(result.value);
    else logger.warn({ err: result.reason }, 'Cluster did not return metrics');
  }
  if (snapshots.length === 0) return renderMetrics();
  return AggregatorRegistry.aggregate([await metricsSnapshot(), ...snapshots]).metrics();
}
