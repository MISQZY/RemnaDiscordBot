import type { UserGuild } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { GuildSnapshotReader } from '@bot/discord';
import type { Redis } from 'ioredis';
import { ApiError } from '../errors.js';
import { canManageGuild } from '../permissions.js';
import type { DiscordOAuth, DiscordPartialGuild } from './discord-oauth.js';
import type { Session, SessionStore } from './sessions.js';

const GUILDS_CACHE_SEC = 60;
const REFRESH_MARGIN_MS = 60_000;

/** Гильдии пользователя с правами и присутствием бота. */
export class UserGuildService {
  constructor(
    private readonly redis: Redis,
    private readonly oauth: DiscordOAuth,
    private readonly sessions: SessionStore,
    private readonly snapshots: GuildSnapshotReader,
  ) {}

  /** Access-токен Discord; обновляется заранее, если скоро истечёт. */
  async accessToken(session: Session): Promise<string> {
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session.accessToken;
    try {
      const tokens = await this.oauth.refresh(session.refreshToken);
      Object.assign(session, tokens);
      await this.sessions.save(session);
      return session.accessToken;
    } catch (err) {
      // Refresh-токен отозван — сессия больше не действительна.
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') await this.sessions.destroy(session.id);
      throw err;
    }
  }

  async list(session: Session): Promise<UserGuild[]> {
    const guilds = await this.discordGuilds(session);
    const result = await Promise.all(
      guilds.map(async (guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: guild.owner,
        canManage: canManageGuild(guild),
        botPresent: await this.snapshots.isPresent(guild.id),
      })),
    );
    // Сначала то, что можно настроить, затем по имени.
    return result.sort((a, b) => Number(b.canManage) - Number(a.canManage) || a.name.localeCompare(b.name));
  }

  async find(session: Session, guildId: string): Promise<UserGuild | undefined> {
    return (await this.list(session)).find((guild) => guild.id === guildId);
  }

  private async discordGuilds(session: Session): Promise<DiscordPartialGuild[]> {
    const key = RedisKeys.userGuilds(session.userId);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as DiscordPartialGuild[];

    const guilds = await this.oauth.getGuilds(await this.accessToken(session));
    await this.redis.set(key, JSON.stringify(guilds), 'EX', GUILDS_CACHE_SEC);
    return guilds;
  }
}
