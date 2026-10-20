import type { BotModuleContext } from '@bot/core';
import { createLogger } from '@bot/logger';
import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { onMessage } from './bot.js';
import { defaultLevelingConfig, type LevelingConfig } from './config.js';
import { LevelingService } from './service.js';

const GUILD = '100000000000000001';

describe('leveling with a database', () => {
  let database: TestDatabase;
  let service: LevelingService;

  beforeAll(async () => {
    database = await createTestDatabase();
    service = new LevelingService(database.db);
  });

  beforeEach(async () => {
    await database.db.memberLevel.deleteMany();
  });

  afterAll(async () => {
    await database.cleanup();
  });

  it('accumulates XP and reports level-ups once', async () => {
    const first = await service.addXp(GUILD, '1', 60, { username: 'neo' }, { countMessage: true });
    const second = await service.addXp(GUILD, '1', 60, {}, { countMessage: true });
    const third = await service.addXp(GUILD, '1', 10);

    expect(first.leveledUp).toBe(false);
    expect(second).toMatchObject({ leveledUp: true, previousLevel: 0, row: { xp: 120, level: 1, messages: 2, username: 'neo' } });
    expect(third.leveledUp).toBe(false);
  });

  it('ranks members and pages the leaderboard', async () => {
    await service.setXp(GUILD, 'a', 500);
    await service.setXp(GUILD, 'b', 900);
    await service.setXp(GUILD, 'c', 100);
    await service.setXp('999', 'x', 10_000);

    expect(await service.rankOf(GUILD, 500)).toBe(2);
    const { items, total } = await service.leaderboard(GUILD, 1, 2);
    expect(total).toBe(3);
    expect(items.map((e) => [e.rank, e.userId])).toEqual([[3, 'c']]);
  });

  it('awards message XP with a shared cooldown and announces level-ups', async () => {
    const config: LevelingConfig = { ...defaultLevelingConfig, xpPerMessage: { min: 100, max: 100 }, cooldownSec: 60 };
    const channel = { isSendable: () => true, send: vi.fn(async () => {}) };
    const member = {
      id: '2',
      nickname: null,
      joinedAt: null,
      user: { id: '2', username: 'trinity', globalName: null, createdAt: new Date(), displayAvatarURL: () => '' },
      guild: { id: GUILD, name: 'Zion', memberCount: 3, iconURL: () => null,
        roles: { cache: new Map() },
        members: { me: null },
        client: { user: { id: '3', displayName: 'Bot', displayAvatarURL: () => '' } },
      },
      roles: { cache: new Map() },
    };
    const message = {
      inGuild: () => true,
      guildId: GUILD,
      channelId: '3',
      channel,
      system: false,
      author: { id: '2', bot: false, username: 'trinity', avatar: null },
      member,
      guild: member.guild,
    } as never;
    const ctx = {
      db: database.db,
      redis: createTestRedis(),
      logger: createLogger({ service: 'test', level: 'silent', pretty: false }),
      getConfig: async () => config,
    } as unknown as BotModuleContext<LevelingConfig>;

    await onMessage(ctx, message);
    await onMessage(ctx, message);

    expect((await service.get(GUILD, '2'))?.xp).toBe(100);
    expect(channel.send).toHaveBeenCalledWith({ content: '<@2> достиг уровня **1**! 🎉', allowedMentions: { parse: ['users'] } });
  });
});
