import { randomUUID } from 'node:crypto';
import { RedisKeys } from '@bot/core';

export const STATE_KEY = RedisKeys.orchestrationState;
export const TICK_MS = 5_000;
export const NODE_TTL_MS = 30_000;
export const LEASE_MS = 45_000;
export const SAFETY_MS = 10_000;
export const COOLDOWN_MS = 300_000;
export const STABLE_MS = 30_000;
const MIB = 1024 * 1024;

export interface ClusterLoad {
  memoryBytes: number;
  cpuCores: number;
  eventLoopDelayMs: number;
  eventsPerSecond: number;
  ready: boolean;
}

export interface NodeReport {
  session: string;
  seenAt: number;
  joinedAt: number;
  maxClusters: number;
  memoryBytes: number;
  cpuCores: number;
  /** Memory and CPU used by the manager, apart from its clusters. */
  overheadBytes: number;
  hostPressure: number;
  clusters: Record<string, ClusterLoad>;
  blocked: Record<string, number>;
}

export interface Lease {
  node: string;
  session: string;
  token: string;
  expiresAt: number;
}

export interface Topology {
  totalShards: number;
  shardsPerCluster: number;
}

/** Runtime options can include credentials; only these two fields may enter shared topology. */
export function topologyOf({ totalShards, shardsPerCluster }: Topology): Topology {
  return { totalShards, shardsPerCluster };
}

export interface State {
  topology: Topology;
  /** A missing Redis state waits out every lease before allowing a new owner. */
  notBefore: number;
  nodes: Record<string, NodeReport>;
  drained: string[];
  targets: Record<string, string>;
  leases: Record<string, Lease>;
  leader?: { node: string; session: string; expiresAt: number };
  lastMoveAt: number;
}

export function newState(topology: Topology, now: number): State {
  return { topology: topologyOf(topology), notBefore: now + LEASE_MS, nodes: {}, drained: [], targets: {}, leases: {}, lastMoveAt: now };
}

export function assertTopology(state: State, topology: Topology): void {
  if (state.topology.totalShards !== topology.totalShards || state.topology.shardsPerCluster !== topology.shardsPerCluster) {
    throw new Error('Sharding topology differs from Redis. Stop every bot before resetting orchestration state.');
  }
  // Repair legacy state in place without discarding live ownership or restarting clusters.
  state.topology = topologyOf(state.topology);
}

export function shardsFor(cluster: number, topology: Topology): number[] {
  const first = cluster * topology.shardsPerCluster;
  return Array.from({ length: Math.min(topology.shardsPerCluster, topology.totalShards - first) }, (_, i) => first + i);
}

function live(node: NodeReport | undefined, now: number): node is NodeReport {
  return !!node && node.seenAt + NODE_TTL_MS > now;
}

function loadOf(state: State, cluster: string): ClusterLoad {
  const lease = state.leases[cluster];
  return (lease && state.nodes[lease.node]?.clusters[cluster]) ?? {
    memoryBytes: 128 * MIB, cpuCores: 0.1, eventLoopDelayMs: 0, eventsPerSecond: 0, ready: false,
  };
}

function assigned(state: State, node: string): string[] {
  // During a move both nodes need capacity until the old process has stopped.
  return [...new Set([
    ...Object.keys(state.targets).filter((id) => state.targets[id] === node),
    ...Object.keys(state.leases).filter((id) => state.leases[id]?.node === node),
  ])];
}

function pressure(state: State, id: string, extra?: string, omit?: string): number {
  const node = state.nodes[id]!;
  const clusters = assigned(state, id).filter((cluster) => cluster !== omit);
  if (extra && !clusters.includes(extra)) clusters.push(extra);
  const loads = clusters.map((cluster) => loadOf(state, cluster));
  return Math.max(
    (node.overheadBytes + loads.reduce((sum, load) => sum + load.memoryBytes, 0)) / node.memoryBytes / 0.85,
    loads.reduce((sum, load) => sum + load.cpuCores, 0) / node.cpuCores / 0.75,
    clusters.length / node.maxClusters,
    ...loads.map((load) => load.eventLoopDelayMs / 150),
    node.hostPressure,
  );
}

export function canAssign(state: State, id: string, cluster: string, now: number): boolean {
  const node = state.nodes[id];
  return live(node, now) && !state.drained.includes(id) &&
    (node.blocked[cluster] ?? 0) <= now && pressure(state, id, cluster) <= 1;
}

/** Only the elected manager calls this; its write is committed with compare-and-set. */
export function plan(state: State, now: number): void {
  if (now < state.notBefore) return;
  for (const [id, lease] of Object.entries(state.leases)) {
    if (lease.expiresAt <= now) delete state.leases[id];
  }
  const ids = Object.keys(state.nodes).sort();
  const count = Math.ceil(state.topology.totalShards / state.topology.shardsPerCluster);
  for (let cluster = 0; cluster < count; cluster++) {
    const id = String(cluster);
    const current = state.targets[id];
    const node = current ? state.nodes[current] : undefined;
    if (current && live(node, now) && !state.drained.includes(current) && (node.blocked[id] ?? 0) <= now) continue;
    const candidates = ids.filter((candidate) => canAssign(state, candidate, id, now));
    candidates.sort((a, b) => pressure(state, a, id) - pressure(state, b, id) || a.localeCompare(b));
    if (candidates[0]) state.targets[id] = candidates[0];
    else delete state.targets[id];
  }
  // Never stack planned balancing moves or move an unready cluster.
  if (now - state.lastMoveAt < COOLDOWN_MS || Object.entries(state.leases).some(([id, lease]) => state.targets[id] !== lease.node)) return;
  let best: { cluster: string; target: string; gain: number } | undefined;
  for (const [cluster, source] of Object.entries(state.targets)) {
    const sourceNode = state.nodes[source];
    if (!live(sourceNode, now) || !loadOf(state, cluster).ready) continue;
    // A single busy shard cannot be split by moving it. Move only if the pair's peak decreases.
    const beforeSource = pressure(state, source);
    for (const target of ids) {
      const targetNode = state.nodes[target]!;
      if (target === source || now - targetNode.joinedAt < STABLE_MS || !canAssign(state, target, cluster, now)) continue;
      const before = Math.max(beforeSource, pressure(state, target));
      const after = Math.max(pressure(state, source, undefined, cluster), pressure(state, target, cluster));
      const gain = before - after;
      if (gain >= 0.15 && (!best || gain > best.gain)) best = { cluster, target, gain };
    }
  }
  if (best) {
    state.targets[best.cluster] = best.target;
    state.lastMoveAt = now;
  }
  // Bound records left by nodes removed from inventory.
  for (const id of ids) {
    if (!live(state.nodes[id], now) && !Object.values(state.leases).some((lease) => lease.node === id)) delete state.nodes[id];
  }
}

export function reportNode(state: State, id: string, report: NodeReport, now: number): void {
  const previous = state.nodes[id];
  if (previous && previous.session !== report.session && live(previous, now)) throw new Error(`Another manager is using SHARD_NODE_ID=${id}`);
  state.nodes[id] = { ...report, seenAt: now, joinedAt: previous?.session === report.session ? previous.joinedAt : now };
  if (!state.leader || state.leader.expiresAt <= now || (state.leader.node === id && state.leader.session === report.session)) {
    state.leader = { node: id, session: report.session, expiresAt: now + NODE_TTL_MS };
    plan(state, now);
  }
  for (const [cluster, target] of Object.entries(state.targets)) {
    const lease = state.leases[cluster];
    if (target !== id || state.drained.includes(id) || (report.blocked[cluster] ?? 0) > now) continue;
    if (lease && lease.expiresAt > now && (lease.node !== id || lease.session !== report.session)) continue;
    state.leases[cluster] = {
      node: id, session: report.session,
      token: lease && lease.expiresAt > now ? lease.token : randomUUID(),
      expiresAt: now + LEASE_MS,
    };
  }
}
