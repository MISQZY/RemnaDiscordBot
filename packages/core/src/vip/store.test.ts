import type { PrismaClient } from '@bot/db';
import { describe, expect, it, vi } from 'vitest';
import { PrismaVipStore } from './store.js';

describe('PrismaVipStore', () => {
  it('incrementally applies changes without dropping existing unchanged guilds', async () => {
    const existing = [
      { guildId: 'g1', expiresAt: new Date('2026-11-01T00:00:00Z') },
      { guildId: 'g2', expiresAt: null },
    ];
    const findMany = vi.fn().mockResolvedValue(existing);
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const settingsUpsert = vi.fn().mockResolvedValue({});

    const tx = {
      vipSettings: { upsert: settingsUpsert },
      guildVip: { findMany, deleteMany, upsert },
    };
    const db = {
      $transaction: async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaClient;

    const store = new PrismaVipStore(db);

    // g1 has identical expiration, g2 is deleted, g3 is new
    await store.replace({
      modules: ['music'],
      features: [],
      guilds: [
        { guildId: 'g1', expiresAt: '2026-11-01T00:00:00.000Z' },
        { guildId: 'g3', expiresAt: '2026-12-01T00:00:00.000Z' },
      ],
    });

    expect(deleteMany).toHaveBeenCalledWith({ where: { guildId: { in: ['g2'] } } });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { guildId: 'g3' },
      create: { guildId: 'g3', expiresAt: new Date('2026-12-01T00:00:00.000Z') },
      update: { expiresAt: new Date('2026-12-01T00:00:00.000Z') },
    });
    expect(settingsUpsert.mock.invocationCallOrder[0]).toBeLessThan(findMany.mock.invocationCallOrder[0]!);
  });

  it('compares concurrent replacements against the state after the preceding transaction', async () => {
    const guilds = new Map<string, Date | null>([['g1', null]]);
    const findMany = async () => [...guilds].map(([guildId, expiresAt]) => ({ guildId, expiresAt }));
    const tx = {
      vipSettings: { upsert: async () => ({}) },
      guildVip: {
        findMany,
        deleteMany: async ({ where }: { where: { guildId: { in: string[] } } }) => {
          for (const id of where.guildId.in) guilds.delete(id);
        },
        upsert: async ({ create }: { create: { guildId: string; expiresAt: Date | null } }) => {
          guilds.set(create.guildId, create.expiresAt);
        },
      },
    };
    // The settings-row write serializes these transactions, as it does in PostgreSQL.
    let queue = Promise.resolve();
    const db = {
      guildVip: { findMany },
      $transaction: (fn: (client: typeof tx) => Promise<void>) => {
        const next = queue.then(() => fn(tx));
        queue = next;
        return next;
      },
    } as unknown as PrismaClient;
    const store = new PrismaVipStore(db);

    await Promise.all([
      store.replace({ modules: [], features: [], guilds: [] }),
      store.replace({ modules: ['music'], features: [], guilds: [{ guildId: 'g1', expiresAt: null }] }),
    ]);

    expect([...guilds]).toEqual([['g1', null]]);
  });
});
