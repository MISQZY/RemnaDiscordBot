import type { Guild } from 'discord.js';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { GuildSnapshotReader, GuildSnapshotWriter } from './snapshots.js';

const GUILD = '111111111111111111';
const BOT_ROLE = '333333333333333333';

/** Minimal in-memory Redis stand-in for the commands snapshots use. */
function fakeRedis(): Redis {
  const data = new Map<string, string>();
  const redis = {
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string) => void data.set(key, value),
    exists: async (key: string) => (data.has(key) ? 1 : 0),
    del: async (...keys: string[]) => keys.filter((k) => data.delete(k)).length,
    multi: () => {
      const ops: (() => void)[] = [];
      const chain = {
        set: (key: string, value: string) => (ops.push(() => data.set(key, value)), chain),
        exec: async () => ops.map((op) => op()),
      };
      return chain;
    },
  };
  return redis as unknown as Redis;
}

function manager<T>(items: T[]) {
  return { cache: { map: <R>(fn: (item: T) => R) => items.map(fn) } };
}

function fakeGuild(): Guild {
  const guild = { id: GUILD } as Record<string, unknown>;
  Object.assign(guild, {
    name: 'Test',
    icon: null,
    ownerId: '222222222222222222',
    memberCount: 42,
    shardId: 0,
    channels: manager([{ id: '444444444444444444', name: 'general', type: 0, parentId: null, position: 1 }]),
    roles: manager([
      { id: GUILD, name: '@everyone', color: 0, position: 0, managed: false, editable: true, guild },
      { id: BOT_ROLE, name: 'Bot', color: 0, position: 2, managed: true, editable: false, guild },
      { id: '555555555555555555', name: 'Member', color: 0xff0000, position: 1, managed: false, editable: true, guild },
    ]),
    emojis: manager([{ id: '666666666666666666', name: 'wave', animated: null }]),
  });
  return guild as unknown as Guild;
}

describe('guild snapshots', () => {
  it('round-trips guild data through Redis', async () => {
    const redis = fakeRedis();
    const writer = new GuildSnapshotWriter(redis);
    const reader = new GuildSnapshotReader(redis);

    await writer.writeGuild(fakeGuild());

    expect(await reader.isPresent(GUILD)).toBe(true);
    expect(await reader.getMeta(GUILD)).toMatchObject({ name: 'Test', memberCount: 42 });
    expect(await reader.getChannels(GUILD)).toEqual([
      { id: '444444444444444444', name: 'general', type: 0, parentId: null, position: 1 },
    ]);
    expect((await reader.getRoles(GUILD))?.map((r) => [r.name, r.manageable])).toEqual([
      ['@everyone', false],
      ['Bot', false],
      ['Member', true],
    ]);
    expect(await reader.getEmojis(GUILD)).toEqual([{ id: '666666666666666666', name: 'wave', animated: false }]);
  });

  it('removes all keys when the bot leaves', async () => {
    const redis = fakeRedis();
    const writer = new GuildSnapshotWriter(redis);
    const reader = new GuildSnapshotReader(redis);

    await writer.writeGuild(fakeGuild());
    await writer.removeGuild(GUILD);

    expect(await reader.isPresent(GUILD)).toBe(false);
    expect(await reader.getRoles(GUILD)).toBeNull();
  });
});
