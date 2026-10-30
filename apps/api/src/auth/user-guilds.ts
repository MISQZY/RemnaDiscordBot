import type { UserGuild } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { GuildSnapshotReader } from '@bot/discord';
import type { Redis } from 'ioredis';
import { ApiError } from '../errors.js';
import { canManageGuild } from '../permissions.js';
import type { DiscordOAuth, DiscordPartialGuild, DiscordTokens } from './discord-oauth.js';
import type { Session, SessionStore } from './sessions.js';

const GUILDS_CACHE_SEC = 60;
/** How long the last list stands in while Discord refuses: short, as it may still grant a revoked permission. */
const LAST_GUILDS_SEC = 10 * 60;
const REFRESH_MARGIN_MS = 60_000;

/**
 * The user's guilds with permissions and bot presence. Every guild route checks access through them, and a page of
 * the dashboard sends several at once: Discord is asked once for them all (per process), as its guild list allows
 * few requests per token, and the list it gave last stands in while it refuses — for reading only: a change waits
 * for Discord to confirm the user still manages the guild.
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

  async list(session: Session, { refresh = false } = {}): Promise<UserGuild[]> {
    const guilds = await this.discordGuilds(session, { stale: !refresh, refresh });
    const present = await this.snapshots.presentMany(guilds.map((guild) => guild.id));
    const result = guilds.map((guild, i) => toUserGuild(guild, present[i]!));
    // Manageable guilds first, then by name.
    return result.sort((a, b) => Number(b.canManage) - Number(a.canManage) || a.name.localeCompare(b.name));
  }

  /** The guild among the user's, checked for the bot only; `stale` — the last list will do while Discord refuses. */
  async find(session: Session, guildId: string, { stale = false } = {}): Promise<UserGuild | undefined> {
    const guild = (await this.discordGuilds(session, { stale })).find((g) => g.id === guildId);
    return guild && toUserGuild(guild, await this.snapshots.isPresent(guildId));
  }

  private async discordGuilds(session: Session, { stale, refresh = false }: { stale: boolean; refresh?: boolean }): Promise<DiscordPartialGuild[]> {
    const cached = refresh ? null : await this.redis.get(RedisKeys.userGuilds(session.userId));
    if (cached) return JSON.parse(cached) as DiscordPartialGuild[];

    let pending = this.fetching.get(session.userId);
    if (!pending) {
      pending = this.fetchGuilds(session).finally(() => this.fetching.delete(session.userId));
      this.fetching.set(session.userId, pending);
    }
    try {
      return await pending;
    } catch (err) {
      // Discord refuses for now: the list it gave last will do for reading; a revoked token still ends the request.
      const refused = err instanceof ApiError && (err.code === 'RATE_LIMITED' || err.code === 'DISCORD_UNAVAILABLE');
      const last = stale && refused ? await this.redis.get(RedisKeys.userGuildsLast(session.userId)) : null;
      if (last) return JSON.parse(last) as DiscordPartialGuild[];
      throw err;
    }
  }

  private async fetchGuilds(session: Session): Promise<DiscordPartialGuild[]> {
    const guilds = await this.oauth.getGuilds(await this.accessToken(session));
    const json = JSON.stringify(guilds);
    await this.redis
      .multi()
      .set(RedisKeys.userGuilds(session.userId), json, 'EX', GUILDS_CACHE_SEC)
      .set(RedisKeys.userGuildsLast(session.userId), json, 'EX', LAST_GUILDS_SEC)
      .exec();
    return guilds;
  }
}

function toUserGuild(guild: DiscordPartialGuild, botPresent: boolean): UserGuild {
  return { id: guild.id, name: guild.name, icon: guild.icon, owner: guild.owner, canManage: canManageGuild(guild), botPresent };
}
