import type { BotModuleContext } from '@bot/core';
import { createLogger } from '@bot/logger';
import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onMessage } from './bot.js';
import { defaultCustomCommandsConfig, type CustomCommandsConfig } from './config.js';

const GUILD = '100000000000000001';

describe('trigger replies', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.db.customCommand.create({
      data: {
        guildId: GUILD,
        name: 'weather',
        kind: 'trigger',
        matchMode: 'startsWith',
        pattern: '!погода',
        response: { content: '{user.mention}, в городе {args} солнечно' },
        actions: { addRoleIds: [], removeRoleIds: [], deleteTrigger: true },
        allowedChannelIds: [],
        allowedRoleIds: [],
        cooldownSec: 60,
        createdBy: '1',
      },
    });
  });

  afterAll(async () => {
    await database.cleanup();
  });

  it('replies once per cooldown and counts uses', async () => {
    const send = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const member = {
      id: '2',
      nickname: null,
      joinedAt: null,
      user: { id: '2', username: 'neo', globalName: null, createdAt: new Date(), displayAvatarURL: () => '' },
      guild: { id: GUILD, name: 'Zion', memberCount: 1, iconURL: () => null, roles: { cache: new Map() } },
      roles: { cache: new Map() },
    };
    const message = {
      inGuild: () => true,
      guildId: GUILD,
      channelId: '3',
      channel: { name: 'general', send },
      author: { id: '2', bot: false },
      member,
      content: '!погода Москва',
      delete: remove,
    } as never;
    const ctx = {
      db: database.db,
      redis: createTestRedis(),
      logger: createLogger({ service: 'test', level: 'silent', pretty: false }),
      getConfig: async (): Promise<CustomCommandsConfig> => defaultCustomCommandsConfig,
    } as unknown as BotModuleContext<CustomCommandsConfig>;

    await onMessage(ctx, message);
    await onMessage(ctx, message);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ content: '<@2>, в городе Москва солнечно', allowedMentions: { parse: ['users'] } });
    expect(remove).toHaveBeenCalledOnce();
    expect((await database.db.customCommand.findFirstOrThrow()).uses).toBe(1);
  });
});
