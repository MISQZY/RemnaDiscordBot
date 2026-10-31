import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotWriter } from '@bot/discord';
import { createLogger } from '@bot/logger';
import { Client, type Guild } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuildLifecycle, initialLocale, SNAPSHOT_REFRESH_MS } from './guilds.js';

const GUILD = '111111111111111111';

function setup() {
  const db = {
    guild: {
      upsert: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const snapshots = {
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
