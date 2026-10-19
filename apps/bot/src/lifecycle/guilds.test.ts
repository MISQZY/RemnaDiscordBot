import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotWriter } from '@bot/discord';
import { createLogger } from '@bot/logger';
import type { Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { GuildLifecycle, initialLocale } from './guilds.js';

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
