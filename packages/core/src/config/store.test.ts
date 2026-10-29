import type { PrismaClient } from '@bot/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigConflictError, PrismaConfigStore } from './store.js';

function setup() {
  type Row = { enabled: boolean; config: unknown; version: number; updatedAt: Date };
  let row: Row | null = null;
  let tail = Promise.resolve();
  const table = {
    create: async ({ data }: { data: Row }) => {
      if (row) throw Object.assign(new Error('Unique key'), { code: 'P2002' });
      return row = { ...data };
    },
    updateMany: async ({ where, data }: { where: { updatedAt: Date }; data: Row }) => {
      if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
      row = { ...data };
      return { count: 1 };
    },
    findUniqueOrThrow: async () => {
      if (!row) throw new Error('Missing config');
      return { ...row };
    },
  };
  const db = { $transaction: <T>(run: (tx: { guildModuleConfig: typeof table }) => Promise<T>) => {
    const result = tail.then(() => run({ guildModuleConfig: table }));
    tail = result.then(() => {}, () => {});
    return result;
  } };
  const store = new PrismaConfigStore(db as unknown as PrismaClient);
  const save = (expected: string | null, n: number) => store.save('guild', 'leveling', { enabled: true, config: { n }, version: 1 }, 'admin', expected);
  return { save, get: () => row };
}

afterEach(() => vi.useRealTimers());

describe('atomic config versions', () => {
  it('lets exactly one concurrent writer create the initial config', async () => {
    const { save } = setup();
    const results = await Promise.allSettled([save(null, 1), save(null, 2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(ConfigConflictError) });
  });

  it('rejects the second writer with the same ETag and preserves the winner', async () => {
    const { save, get } = setup();
    const initial = await save(null, 0);
    const results = await Promise.allSettled([save(initial.updatedAt, 1), save(initial.updatedAt, 2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(ConfigConflictError) });
    expect(get()?.config).toEqual({ n: 1 });
  });

  it('advances the ETag when saves share a millisecond or the clock moves back', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
    const { save } = setup();
    const first = await save(null, 0);
    const second = await save(first.updatedAt, 1);
    vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
    const third = await save(second.updatedAt, 2);
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
    expect(Date.parse(third.updatedAt)).toBeGreaterThan(Date.parse(second.updatedAt));
    await expect(save(first.updatedAt, 3)).rejects.toBeInstanceOf(ConfigConflictError);
  });
});
