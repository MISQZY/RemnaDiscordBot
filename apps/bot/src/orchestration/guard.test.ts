import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { startLeaseGuard } from './guard.js';
import { readState } from './store.js';
import { LEASE_MS, newState, SAFETY_MS } from './state.js';

vi.mock('./store.js', () => ({ readState: vi.fn() }));
const read = vi.mocked(readState);
const redis = {} as Redis;
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

function snapshot() {
  const state = newState({ totalShards: 1, shardsPerCluster: 1 }, 1000);
  state.leases['0'] = { node: 'a', session: 's', token: 'token', expiresAt: 1000 + LEASE_MS };
  return { state, raw: '', now: 1000 };
}

describe('lease watchdog', () => {
  it('refuses to start after token replacement or state loss', async () => {
    read.mockResolvedValue({ state: null, raw: '', now: 1000 });
    const revoke = vi.fn();
    const stop = await startLeaseGuard(redis, 0, 'token', revoke);
    expect(revoke).toHaveBeenCalledOnce();
    stop();
  });

  it('exits before the lease expires even if subsequent Redis calls fail', async () => {
    vi.useFakeTimers();
    read.mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error('network partition'));
    const revoke = vi.fn();
    const stop = await startLeaseGuard(redis, 0, 'token', revoke);
    await vi.advanceTimersByTimeAsync(LEASE_MS - SAFETY_MS + 1);
    expect(revoke).toHaveBeenCalled();
    stop();
  });

  it('stops immediately when another token replaces the lease', async () => {
    vi.useFakeTimers();
    read.mockResolvedValueOnce(snapshot());
    const replaced = snapshot();
    replaced.state.leases['0']!.token = 'replacement';
    read.mockResolvedValue(replaced);
    const revoke = vi.fn();
    const stop = await startLeaseGuard(redis, 0, 'token', revoke);
    await vi.advanceTimersByTimeAsync(2001);
    expect(revoke).toHaveBeenCalledOnce();
    stop();
  });
});
