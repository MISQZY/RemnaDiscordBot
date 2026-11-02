import { RedisKeys } from '@bot/core';
import type { REST } from 'discord.js';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { UserDirectory } from './user-directory.js';

const ID = '100000000000000001';
function setup(get: ReturnType<typeof vi.fn>) {
  const rows = new Map<string, string>();
  const redis = {
    mget: async (keys: string[]) => keys.map((key) => rows.get(key) ?? null),
    get: async (key: string) => rows.get(key) ?? null,
    set: async (key: string, value: string) => { rows.set(key, value); },
  } as unknown as Redis;
  return { directory: new UserDirectory(redis, { get } as unknown as REST), rows };
}

describe('user directory loading', () => {
  it('shares overlapping user lookups across simultaneous screens', async () => {
    let release!: (value: unknown) => void;
    const get = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const { directory } = setup(get);
    const reads = Array.from({ length: 20 }, () => directory.resolve([ID]));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    release({ username: 'listener', global_name: 'Listener', avatar: null });
    for (const result of await Promise.all(reads)) expect(result[ID]?.username).toBe('listener');
    await directory.resolve([ID]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps free slots working when one Discord user lookup is slow', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => String(BigInt(ID) + BigInt(i)));
    let release!: () => void;
    let active = 0;
    let peak = 0;
    const get = vi.fn(async (route: string) => {
      active++;
      peak = Math.max(peak, active);
      if (route === `/users/${ID}`) await new Promise<void>((resolve) => { release = resolve; });
      else await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { username: route };
    });
    const { directory } = setup(get);
    const pending = directory.resolve(ids);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(10));
    expect(peak).toBeLessThanOrEqual(5);
    release();
    expect(Object.keys(await pending)).toHaveLength(10);
  });

  it('recovers corrupted cache entries without failing the entire name list', async () => {
    const get = vi.fn(async () => ({ username: 'recovered' }));
    const { directory, rows } = setup(get);
    rows.set(RedisKeys.user(ID), '{broken');
    expect(await directory.resolve([ID], { fetchMissing: false })).toEqual({});
    expect((await directory.resolve([ID]))[ID]?.username).toBe('recovered');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('can retry transient failures instead of retaining a failed in-flight entry', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ username: 'online' });
    const { directory } = setup(get);
    expect(await directory.resolve([ID])).toEqual({});
    expect((await directory.resolve([ID]))[ID]?.username).toBe('online');
  });
});
