import { describe, expect, it } from 'vitest';
import { hostShards } from './sharding.js';

describe('hostShards', () => {
  it('runs everything on a single server', () => {
    expect(hostShards({ totalShards: 6, shardsPerCluster: 4, hosts: 1, hostIndex: 0 })).toEqual({
      shardList: [0, 1, 2, 3, 4, 5],
      clusterList: [0, 1],
    });
  });

  it('splits clusters into contiguous ranges that cover every shard once', () => {
    const options = { totalShards: 18, shardsPerCluster: 4, hosts: 3 };
    const shares = [0, 1, 2].map((hostIndex) => hostShards({ ...options, hostIndex }));
    expect(shares.map((share) => share.clusterList)).toEqual([[0], [1, 2], [3, 4]]);
    expect(shares[2]!.shardList).toEqual([12, 13, 14, 15, 16, 17]);
    expect(shares.flatMap((share) => share.shardList)).toEqual(Array.from({ length: 18 }, (_, i) => i));
  });

  it('refuses more servers than clusters', () => {
    expect(() => hostShards({ totalShards: 4, shardsPerCluster: 4, hosts: 2, hostIndex: 1 })).toThrow(/SHARD_HOSTS=2/);
  });
});
