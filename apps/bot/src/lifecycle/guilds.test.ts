import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotWriter } from '@bot/discord';
import { createLogger } from '@bot/logger';
import { Client, Events, type Guild } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuildLifecycle, initialLocale, SNAPSHOT_REFRESH_MS } from './guilds.js';

const GUILD = '111111111111111111';

function setup() {
  const db = {
    guild: {
      findMany: vi.fn(),
      createMany: vi.fn(async () => ({ count: 1 })),
      upsert: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const snapshots = {
    writeMeta: vi.fn(async () => {}),
    writeChannels: vi.fn(async () => {}),
    writeRoles: vi.fn(async () => {}),
    writeEmojis: vi.fn(async () => {}),
    writeGuild: vi.fn(async () => {}),
    removeGuild: vi.fn(async () => {}),
  };
  const lifecycle = new GuildLifecycle(
    db as unknown as PrismaClient,
    snapshots as unknown as GuildSnapshotWriter,
    createLogger({ service: 'test', level: 'silent', pretty: false }),
  );
  return { db, snapshots, lifecycle };
}

const guild = (available = true, preferredLocale = 'ru') => ({ id: GUILD, name: 'Test', available, preferredLocale }) as unknown as Guild;

describe('initialLocale', () => {
  it('takes the server language from Discord and falls back to English', () => {
    expect(initialLocale(guild(true, 'ru'))).toBe('ru');
    expect(initialLocale(guild(true, 'en-GB'))).toBe('en');
    expect(initialLocale(guild(true, 'de'))).toBe('en');
  });
});

describe('GuildLifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('syncs 1000 existing guilds with two reads and no redundant database writes', async () => {
    const { db, snapshots, lifecycle } = setup();
    const guilds = Array.from({ length: 1000 }, (_, i) => ({ ...guild(), id: String(i) }) as Guild);
    db.guild.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, leftAt: null })));
    await lifecycle.syncAll(guilds);
    expect(db.guild.findMany).toHaveBeenCalledTimes(2);
    expect(db.guild.createMany).not.toHaveBeenCalled();
    expect(db.guild.updateMany).not.toHaveBeenCalled();
    expect(db.guild.upsert).not.toHaveBeenCalled();
    expect(snapshots.writeGuild).toHaveBeenCalledTimes(1000);
  });

  it('creates new guilds in a batch and handles a concurrent first insert safely', async () => {
    const { db, snapshots, lifecycle } = setup();
    db.guild.findMany.mockResolvedValue([{ id: 'returning', leftAt: new Date() }]);
    db.guild.createMany.mockRejectedValueOnce(Object.assign(new Error('Concurrent insert'), { code: 'P2002' }));
    await lifecycle.syncAll([{ ...guild(), id: 'returning' } as Guild, guild(true, 'en-GB')]);
    expect(db.guild.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['returning'] }, leftAt: { not: null } }, data: { leftAt: null } });
    expect(db.guild.createMany).toHaveBeenCalledWith({ data: [{ id: GUILD, locale: 'en' }] });
    expect(db.guild.upsert).toHaveBeenCalledWith({ where: { id: GUILD }, create: { id: GUILD, locale: 'en' }, update: { leftAt: null } });
    expect(snapshots.writeGuild).toHaveBeenCalledTimes(2);
  });

  it('coalesces bursts of channel, role and emoji events into one write per snapshot part', async () => {
    vi.useFakeTimers();
    const { snapshots, lifecycle } = setup();
    const client = new Client({ intents: [] });
    const initialListeners = client.listenerCount(Events.ChannelCreate);
    const stop = lifecycle.attach(client);
    try {
      const current = guild();
      for (let i = 0; i < 100; i++) {
        client.emit(Events.ChannelCreate, { guild: current } as never);
        client.emit(Events.GuildRoleCreate, { guild: current } as never);
        client.emit(Events.GuildEmojiCreate, { guild: current } as never);
      }
      expect(snapshots.writeChannels).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      expect(snapshots.writeChannels).toHaveBeenCalledExactlyOnceWith(current);
      expect(snapshots.writeRoles).toHaveBeenCalledExactlyOnceWith(current);
      expect(snapshots.writeEmojis).toHaveBeenCalledExactlyOnceWith(current);
      stop();
      expect(client.listenerCount(Events.ChannelCreate)).toBe(initialListeners);
      client.emit(Events.ChannelCreate, { guild: current } as never);
      await vi.advanceTimersByTimeAsync(50);
      expect(snapshots.writeChannels).toHaveBeenCalledTimes(1);
    } finally { stop(); await client.destroy(); }
  });

  it('cancels pending snapshots when leaving instead of restoring deleted data', async () => {
    vi.useFakeTimers();
    const { snapshots, lifecycle } = setup();
    const client = new Client({ intents: [] });
    const stop = lifecycle.attach(client);
    try {
      client.emit(Events.ChannelCreate, { guild: guild() } as never);
      client.emit(Events.GuildDelete, guild());
      await vi.advanceTimersByTimeAsync(50);
      expect(snapshots.removeGuild).toHaveBeenCalledWith(GUILD);
      expect(snapshots.writeChannels).not.toHaveBeenCalled();
    } finally { stop(); await client.destroy(); }
  });

  it('refreshes unchanged guild snapshots daily and stops the timer on shutdown', async () => {
    vi.useFakeTimers();
    const { db, snapshots, lifecycle } = setup();
    const client = new Client({ intents: [] });
    client.guilds.cache.set(GUILD, guild());
    client.guilds.cache.set('unavailable', guild(false));
    const stop = lifecycle.attach(client);
    try {
      await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_MS * 8);
      expect(snapshots.writeGuild).toHaveBeenCalledTimes(8);
      expect(snapshots.writeGuild).toHaveBeenCalledWith(guild());
      expect(db.guild.upsert).not.toHaveBeenCalled();
      stop();
      await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_MS);
      expect(snapshots.writeGuild).toHaveBeenCalledTimes(8);
    } finally {
      stop();
      await client.destroy();
    }
  });
  it('upserts the guild and writes a snapshot on join', async () => {
    const { db, snapshots, lifecycle } = setup();
    await lifecycle.join(guild());

    expect(db.guild.upsert).toHaveBeenCalledWith({ where: { id: GUILD }, create: { id: GUILD, locale: 'ru' }, update: { leftAt: null } });
    expect(snapshots.writeGuild).toHaveBeenCalledOnce();
  });

  it('marks the guild as left and drops its snapshot', async () => {
    const { db, snapshots, lifecycle } = setup();
    await lifecycle.leave(guild());

    expect(db.guild.updateMany).toHaveBeenCalledWith({ where: { id: GUILD }, data: { leftAt: expect.any(Date) } });
    expect(snapshots.removeGuild).toHaveBeenCalledWith(GUILD);
  });

  it('ignores outages reported as guild deletes', async () => {
    const { db, snapshots, lifecycle } = setup();
    await lifecycle.leave(guild(false));

    expect(db.guild.updateMany).not.toHaveBeenCalled();
    expect(snapshots.removeGuild).not.toHaveBeenCalled();
  });
});
