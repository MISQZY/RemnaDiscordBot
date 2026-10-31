import { Redis } from 'ioredis';
import { canAssign, NODE_TTL_MS, type State } from './state.js';
import { coordinationRedisOptions, readState, updateState } from './store.js';

export function control(state: State, now: number, command: string, id?: string, target?: string): State {
  if (command === 'drain' || command === 'undrain') {
    if (!id || !state.nodes[id]) throw new Error('Unknown node');
    state.drained = state.drained.filter((node) => node !== id);
    if (command === 'drain') state.drained.push(id);
    return state;
  }
  if (command !== 'move' || !id || !/^\d+$/.test(id) || Number(id) >= Math.ceil(state.topology.totalShards / state.topology.shardsPerCluster)) {
    throw new Error('Usage: status | move <clusterId> <nodeId> | drain <nodeId> | undrain <nodeId>');
  }
  const node = target ? state.nodes[target] : undefined;
  if (!target || !node || node.seenAt + NODE_TTL_MS <= now || state.drained.includes(target)) throw new Error('Destination node is unavailable or drained');
  if ((node.blocked[id] ?? 0) > now) throw new Error('Destination node is cooling down after a cluster failure');
  const assigned = new Set([
    ...Object.keys(state.targets).filter((cluster) => state.targets[cluster] === target),
    ...Object.keys(state.leases).filter((cluster) => state.leases[cluster]?.node === target),
    String(Number(id)),
  ]);
  if (assigned.size > node.maxClusters) throw new Error('Destination cluster limit exceeded');
  if (!canAssign(state, target, String(Number(id)), now)) throw new Error('Destination has insufficient resource capacity');
  state.targets[String(Number(id))] = target;
  // Give an operator's move the full cooldown before automatic balancing resumes.
  state.lastMoveAt = now;
  return state;
}

async function main(): Promise<void> {
  const [command = 'status', id, target] = process.argv.slice(2);
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required');
  const redis = new Redis(url, { ...coordinationRedisOptions(), lazyConnect: true });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    if (command === 'status') {
      const { state, now } = await readState(redis);
      if (!state) throw new Error('Dynamic orchestration has not started');
      process.stdout.write(`${JSON.stringify({
        topology: state.topology, leader: state.leader?.node,
        nodes: Object.entries(state.nodes).map(([node, report]) => ({
          node, online: report.seenAt + NODE_TTL_MS > now, drained: state.drained.includes(node),
          memoryBudgetMb: report.memoryBytes / 1024 / 1024, maxClusters: report.maxClusters, clusters: report.clusters,
        })),
        clusters: Array.from({ length: Math.ceil(state.topology.totalShards / state.topology.shardsPerCluster) }, (_, cluster) => ({
          cluster, target: state.targets[String(cluster)] ?? null,
          owner: state.leases[String(cluster)]?.node ?? null,
          leaseRemainingMs: Math.max(0, (state.leases[String(cluster)]?.expiresAt ?? 0) - now),
        })),
      }, null, 2)}\n`);
    } else {
      await updateState(redis, (state, now) => {
        if (!state) throw new Error('Dynamic orchestration has not started');
        return control(state, now, command, id, target);
      });
      process.stdout.write('Orchestration request saved. Managers reconcile it on their next tick.\n');
    }
  } finally {
    redis.disconnect();
  }
}

// Keep the command handler importable by tests without opening a Redis connection.
if (process.argv[1]?.replaceAll('\\', '/').match(/\/orchestration\/control\.(?:js|ts)$/)) {
  void main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
