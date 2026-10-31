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
      guildVip: { deleteMany, upsert },
    };
    const db = {
      guildVip: { findMany },
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
  });
});
