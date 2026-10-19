import type { UserGuild } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { GuildSnapshotReader } from '@bot/discord';
import type { Redis } from 'ioredis';
import { ApiError } from '../errors.js';
import { canManageGuild } from '../permissions.js';
import type { DiscordOAuth, DiscordPartialGuild, DiscordTokens } from './discord-oauth.js';
import type { Session, SessionStore } from './sessions.js';

const GUILDS_CACHE_SEC = 60;
const LAST_GUILDS_SEC = 60 * 60;
const REFRESH_MARGIN_MS = 60_000;

/**
 * The user's guilds with permissions and bot presence. Every guild route checks access through them, and a page of
 * the dashboard sends several at once: Discord is asked once for them all (per process), as its guild list allows
 * few requests per token, and the list it gave last stands in while it refuses.
 */
export class UserGuildService {
  private readonly fetching = new Map<string, Promise<DiscordPartialGuild[]>>();
  private readonly refreshing = new Map<string, Promise<DiscordTokens>>();

  constructor(
    private readonly redis: Redis,
    private readonly oauth: DiscordOAuth,
    private readonly sessions: SessionStore,
    private readonly snapshots: GuildSnapshotReader,
  ) {}

  /** Discord access token; refreshed ahead of time when it is about to expire. */
  async accessToken(session: Session): Promise<string> {
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session.accessToken;
    // A refresh token works once: requests at the same time share the refresh, or all but one would fail it and end
    // the session.
    let refresh = this.refreshing.get(session.id);
    if (!refresh) {
      refresh = this.refreshTokens(session).finally(() => this.refreshing.delete(session.id));
      this.refreshing.set(session.id, refresh);
    }
    Object.assign(session, await refresh);
    return session.accessToken;
  }

  private async refreshTokens(session: Session): Promise<DiscordTokens> {
    try {
      const tokens = await this.oauth.refresh(session.refreshToken);
      await this.sessions.save({ ...session, ...tokens });
      return tokens;
    } catch (err) {
      // The refresh token was revoked — the session is no longer valid.
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
    // Manageable guilds first, then by name.
    return result.sort((a, b) => Number(b.canManage) - Number(a.canManage) || a.name.localeCompare(b.name));
  }

  async find(session: Session, guildId: string): Promise<UserGuild | undefined> {
    return (await this.list(session)).find((guild) => guild.id === guildId);
  }

  private async discordGuilds(session: Session): Promise<DiscordPartialGuild[]> {
    const cached = await this.redis.get(RedisKeys.userGuilds(session.userId));
    if (cached) return JSON.parse(cached) as DiscordPartialGuild[];

    let pending = this.fetching.get(session.userId);
    if (!pending) {
      pending = this.fetchGuilds(session).finally(() => this.fetching.delete(session.userId));
      this.fetching.set(session.userId, pending);
    }
    return pending;
  }

  private async fetchGuilds(session: Session): Promise<DiscordPartialGuild[]> {
    try {
      const guilds = await this.oauth.getGuilds(await this.accessToken(session));
      const json = JSON.stringify(guilds);
      await this.redis
        .multi()
        .set(RedisKeys.userGuilds(session.userId), json, 'EX', GUILDS_CACHE_SEC)
        .set(RedisKeys.userGuildsLast(session.userId), json, 'EX', LAST_GUILDS_SEC)
        .exec();
      return guilds;
    } catch (err) {
      // Discord refuses for now: the list it gave last will do; a revoked token still ends the request.
      const refused = err instanceof ApiError && (err.code === 'RATE_LIMITED' || err.code === 'DISCORD_UNAVAILABLE');
      const last = refused ? await this.redis.get(RedisKeys.userGuildsLast(session.userId)) : null;
      if (last) return JSON.parse(last) as DiscordPartialGuild[];
      throw err;
    }
  }
}
