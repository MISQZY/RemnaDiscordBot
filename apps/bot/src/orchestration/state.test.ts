import { describe, expect, it } from 'vitest';
import { control, statusReport } from './control.js';
import { assertTopology, COOLDOWN_MS, LEASE_MS, newState, NODE_TTL_MS, plan, reportNode, shardsFor, type NodeReport, type State } from './state.js';

const topology = { totalShards: 4, shardsPerCluster: 1 };
const now = 1_000_000;
const mib = 1024 * 1024;
function node(session: string, at = now): NodeReport {
  return { session, seenAt: at, joinedAt: at - 60_000, maxClusters: 16, memoryBytes: 2048 * mib, cpuCores: 4, overheadBytes: 40 * mib, hostPressure: 0, clusters: {}, blocked: {} };
}
function fixture(): State {
  const state = newState(topology, now - LEASE_MS);
  state.nodes = { a: node('a1'), b: node('b1'), c: node('c1') };
  return state;
}

describe('dynamic cluster ownership', () => {
  it('whitelists topology fields at creation, repair and CLI output', () => {
    const runtimeOptions = { ...topology, redisUrl: 'redis://:test-secret@localhost:6379', nodeId: 'private-node' };
    const state = newState(runtimeOptions, now);
    expect(state.topology).toEqual(topology);
    // Simulate state created by the previous release, including a still-active lease.
    state.topology = runtimeOptions;
    state.leases['0'] = { node: 'a', session: 'session', token: 'ownership-token', expiresAt: now + LEASE_MS };
    const output = JSON.stringify(statusReport(state, now));
    expect(output).not.toContain('test-secret');
    expect(output).not.toContain('redisUrl');
    expect(output).not.toContain('ownership-token');
    assertTopology(state, topology);
    expect(state.topology).toEqual(topology);
    expect(state.leases['0']!.token).toBe('ownership-token');
  });
  it('waits out old leases when Redis state is lost', () => {
    const state = newState(topology, now);
    reportNode(state, 'a', node('a1'), now);
    expect(state.targets).toEqual({});
    reportNode(state, 'a', node('a1', now + LEASE_MS), now + LEASE_MS);
    expect(Object.keys(state.leases)).toHaveLength(4);
  });

  it('covers the topology once and permits standby nodes', () => {
    const state = fixture();
    plan(state, now);
    expect(Object.keys(state.targets)).toEqual(['0', '1', '2', '3']);
    for (const id of ['a', 'b', 'c']) reportNode(state, id, node(`${id}1`), now);
    expect(Object.keys(state.leases)).toHaveLength(4);
    expect(shardsFor(2, { totalShards: 5, shardsPerCluster: 2 })).toEqual([4]);
    expect(() => assertTopology(state, { ...topology, totalShards: 8 })).toThrow('topology differs');
  });

  it('reassigns a lost node but does not steal its unexpired lease', () => {
    const state = fixture();
    state.targets['0'] = 'a';
    reportNode(state, 'a', node('a1'), now);
    const token = state.leases['0']!.token;
    const at = now + NODE_TTL_MS + 1;
    state.nodes.b = node('b1', at);
    state.nodes.c = node('c1', at);
    plan(state, at);
    const target = state.targets['0']!;
    expect(target).not.toBe('a');
    reportNode(state, target, node(`${target}1`, at), at);
    expect(state.leases['0']!.token).toBe(token);
    reportNode(state, target, node(`${target}1`, now + LEASE_MS + 1), now + LEASE_MS + 1);
    expect(state.leases['0']!.token).not.toBe(token);
    expect(state.leases['0']!.node).toBe(target);
  });

  it('rejects duplicate live node ids and waits for a previous session lease after restart', () => {
    const state = fixture();
    state.targets['0'] = 'a';
    reportNode(state, 'a', node('a1'), now);
    expect(() => reportNode(state, 'a', node('a2'), now + 1)).toThrow('Another manager');
    const token = state.leases['0']!.token;
    reportNode(state, 'a', node('a2', now + NODE_TTL_MS + 1), now + NODE_TTL_MS + 1);
    expect(state.leases['0']!.token).toBe(token);
    expect(state.leases['0']!.session).toBe('a1');
  });

  it('will not place clusters above resource or process limits', () => {
    const state = fixture();
    state.nodes = { a: { ...node('a1'), maxClusters: 1 }, b: { ...node('b1'), memoryBytes: 128 * mib } };
    plan(state, now);
    expect(Object.keys(state.targets)).toHaveLength(1);
    expect(Object.values(state.targets)).toEqual(['a']);
  });

  it('elects a replacement coordinator when the leader stops reporting', () => {
    const state = fixture();
    reportNode(state, 'a', node('a1'), now);
    reportNode(state, 'b', node('b1'), now + 1);
    expect(state.leader?.node).toBe('a');
    reportNode(state, 'b', node('b1'), now + NODE_TTL_MS + 1);
    expect(state.leader?.node).toBe('b');
  });
});

describe('load balancing and operator commands', () => {
  function loaded(): State {
    const state = fixture();
    state.nodes = { a: node('a1'), b: node('b1') };
    state.nodes.a!.cpuCores = 1;
    state.nodes.b!.cpuCores = 1;
    for (let id = 0; id < 4; id++) {
      const cluster = String(id);
      state.targets[cluster] = 'a';
      state.leases[cluster] = { node: 'a', session: 'a1', token: cluster, expiresAt: now + LEASE_MS };
      state.nodes.a!.clusters[cluster] = { memoryBytes: 100 * mib, cpuCores: 0.2, eventLoopDelayMs: 10, eventsPerSecond: 30, ready: true };
    }
    state.lastMoveAt = now - COOLDOWN_MS;
    return state;
  }

  it('moves just one cluster to lower the pair peak and respects cooldown', () => {
    const state = loaded();
    plan(state, now);
    expect(Object.values(state.targets).filter((id) => id === 'b')).toHaveLength(1);
    plan(state, now + 1);
    expect(Object.values(state.targets).filter((id) => id === 'b')).toHaveLength(1);
  });

  it('does not bounce a single hot shard between nodes', () => {
    const state = loaded();
    for (let id = 1; id < 4; id++) state.nodes.a!.clusters[String(id)]!.cpuCores = 0;
    plan(state, now);
    expect(Object.values(state.targets)).toEqual(['a', 'a', 'a', 'a']);
  });

  it('drains a node without renewing its old leases', () => {
    const state = loaded();
    control(state, now, 'drain', 'a');
    const expiry = state.leases['0']!.expiresAt;
    reportNode(state, 'a', node('a1'), now + 1);
    expect(state.leases['0']!.expiresAt).toBe(expiry);
    expect(Object.values(state.targets)).not.toContain('a');
    control(state, now, 'undrain', 'a');
    expect(state.drained).toEqual([]);
  });

  it('validates manual moves, capacity and cooldown', () => {
    const state = loaded();
    expect(() => control(state, now, 'move', '4', 'b')).toThrow('Usage');
    expect(() => control(state, now, 'move', '0', 'missing')).toThrow('unavailable');
    state.nodes.b!.memoryBytes = 128 * mib;
    expect(() => control(state, now, 'move', '0', 'b')).toThrow('capacity');
    state.nodes.b!.memoryBytes = 2048 * mib;
    control(state, now, 'move', '0', 'b');
    expect(state.targets['0']).toBe('b');
    expect(state.leases['0']!.node).toBe('a');
    expect(state.lastMoveAt).toBe(now);
  });
});
