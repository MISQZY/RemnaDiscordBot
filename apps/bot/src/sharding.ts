export interface HostShardsOptions {
  totalShards: number;
  shardsPerCluster: number;
  /** Servers the bot runs on, each with its own manager. */
  hosts: number;
  /** This server, from 0. */
  hostIndex: number;
}

export interface HostShards {
  /** Shards this server's clusters connect, in order. */
  shardList: number[];
  /** Global cluster ids, unique across servers: heartbeats and metrics are keyed by them. */
  clusterList: number[];
}

/**
 * The share of the bot one server runs. Shards are cut into clusters the same way on every server, and the clusters
 * are split into contiguous ranges, one per server: cluster `c` holds shards `c * shardsPerCluster…`, wherever it runs.
 */
export function hostShards({ totalShards, shardsPerCluster, hosts, hostIndex }: HostShardsOptions): HostShards {
  const clusters = Math.ceil(totalShards / shardsPerCluster);
  if (hosts > clusters) {
    throw new Error(`SHARD_HOSTS=${hosts} exceeds the ${clusters} clusters of ${totalShards} shards: a server would run none`);
  }
  const first = Math.floor((hostIndex * clusters) / hosts);
  const end = Math.floor(((hostIndex + 1) * clusters) / hosts);
  const clusterList = Array.from({ length: end - first }, (_, i) => first + i);
  const shardList = Array.from(
    { length: Math.min(end * shardsPerCluster, totalShards) - first * shardsPerCluster },
    (_, i) => first * shardsPerCluster + i,
  );
  return { shardList, clusterList };
}
