import { GuildSnapshotReader, GuildSnapshotWriter } from '@bot/discord';
import { createLogger } from '@bot/logger';
import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import type { Guild } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GuildLifecycle } from './guilds.js';

const GUILD = '111111111111111111';

function manager<T>(items: T[]) {
  return { cache: { map: <R>(fn: (item: T) => R) => items.map(fn), values: () => items.values() } };
}

function fakeGuild(id = GUILD): Guild {
  const guild = { id } as Record<string, unknown>;
  Object.assign(guild, {
    name: 'Test',
    icon: null,
    ownerId: '222222222222222222',
    memberCount: 3,
    shardId: 0,
    available: true,
    preferredLocale: 'ru',
    channels: manager([{ id: '444444444444444444', name: 'general', type: 0, parentId: null, position: 0 }]),
    roles: manager([{ id, name: '@everyone', color: 0, position: 0, managed: false, editable: false, permissions: { bitfield: 0n }, guild }]),
    emojis: manager([]),
  });
  return guild as unknown as Guild;
}

describe('GuildLifecycle with database and Redis', () => {
  let database: TestDatabase;
  const redis = createTestRedis();
  const reader = new GuildSnapshotReader(redis);
  let lifecycle: GuildLifecycle;

  beforeAll(async () => {
    database = await createTestDatabase();
    lifecycle = new GuildLifecycle(
      database.db,
      new GuildSnapshotWriter(redis),
      createLogger({ service: 'test', level: 'silent', pretty: false }),
    );
  });

  afterAll(async () => {
    await database.cleanup();
  });

  it('records the guild and its snapshot on join', async () => {
    await lifecycle.join(fakeGuild());

    expect(await database.db.guild.findUnique({ where: { id: GUILD } })).toMatchObject({ leftAt: null, locale: 'ru' });
    expect(await reader.isPresent(GUILD)).toBe(true);
    expect(await reader.getChannels(GUILD)).toHaveLength(1);
  });

  it('marks the guild as left and clears the snapshot', async () => {
    await lifecycle.leave(fakeGuild());

    const guild = await database.db.guild.findUnique({ where: { id: GUILD } });
    expect(guild?.leftAt).toBeInstanceOf(Date);
    expect(await reader.isPresent(GUILD)).toBe(false);
  });

  it('restores the guild on rejoin and syncs on startup', async () => {
    const other = '333333333333333333';
    await lifecycle.syncAll([fakeGuild(), fakeGuild(other)]);

    const guilds = await database.db.guild.findMany({ orderBy: { id: 'asc' } });
    expect(guilds.map((g) => [g.id, g.leftAt])).toEqual([
      [GUILD, null],
      [other, null],
    ]);
    expect(await reader.isPresent(other)).toBe(true);
  });
});
