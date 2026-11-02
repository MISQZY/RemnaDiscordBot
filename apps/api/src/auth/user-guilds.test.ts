import { RedisKeys } from '@bot/core';
import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotReader } from '@bot/discord';
import { createTestRedis } from '@bot/testing';
import type { REST } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordOAuth } from './discord-oauth.js';
import type { Session, SessionStore } from './sessions.js';
import { UserGuildService } from './user-guilds.js';

const MOD_ROLE = '400000000000000044';
const session = { id: 'session', userId: 'user' } as Session;

describe('guild permission reads', () => {
  it('reads 100 guild settings in one query and limits simultaneous Discord requests', async () => {
    const redis = createTestRedis();
    const guilds = Array.from({ length: 100 }, (_, i) => ({ id: String(300000000000000000n + BigInt(i)), name: `Guild ${i}`, icon: null, owner: false, permissions: '0' }));
    await redis.set(RedisKeys.userGuilds(session.userId), JSON.stringify(guilds));
    const findMany = vi.fn(async () => guilds.map((guild) => ({ id: guild.id, modRoleIds: [MOD_ROLE] })));
    const findUnique = vi.fn();
    let active = 0;
    let peak = 0;
    const get = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { roles: [MOD_ROLE] };
    });
    const service = new UserGuildService(redis, {} as DiscordOAuth, {} as SessionStore,
      { presentMany: async () => guilds.map(() => true) } as unknown as GuildSnapshotReader,
      { guild: { findMany, findUnique } } as unknown as PrismaClient, { get } as unknown as REST);
    const result = await service.list(session);
    expect(result).toHaveLength(100);
    expect(result.every((guild) => guild.isModerator && !guild.canManage)).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
    expect(peak).toBeLessThanOrEqual(5);
    await redis.quit();
  });

  it('shares member lookups from simultaneous permission checks and rereads changed settings', async () => {
    const redis = createTestRedis();
    const findUnique = vi.fn(async () => ({ modRoleIds: [MOD_ROLE] }));
    const get = vi.fn(async () => ({ roles: [MOD_ROLE] }));
    const service = new UserGuildService(redis, {} as DiscordOAuth, {} as SessionStore, {} as GuildSnapshotReader,
      { guild: { findUnique } } as unknown as PrismaClient, { get } as unknown as REST);
    expect((await Promise.all(Array.from({ length: 20 }, () => service.checkModeratorRole('guild', 'user')))).every(Boolean)).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    findUnique.mockResolvedValue({ modRoleIds: [] });
    expect(await service.checkModeratorRole('guild', 'user')).toBe(false);
    await redis.quit();
  });
});
