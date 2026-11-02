import { Snowflake } from '@bot/contracts';
import { eachLimit, RedisKeys } from '@bot/core';
import { DiscordAPIError, RESTJSONErrorCodes, Routes, type REST } from 'discord.js';
import type { Redis } from 'ioredis';
import { z } from 'zod';

/** A Discord user as the dashboard names them: by ID alone it shows nothing readable. */
export const UserInfo = z.object({
  username: z.string(),
  globalName: z.string().nullable(),
  /** Avatar hash; null — the default avatar. */
  avatar: z.string().nullable(),
});
export type UserInfo = z.infer<typeof UserInfo>;

const ApiUser = z.object({ username: z.string(), global_name: z.string().nullish(), avatar: z.string().nullish() });

/** Names change rarely: a day is fresh enough and keeps Discord calls to a minimum. */
const TTL_SEC = 24 * 3600;
/** Marks an ID Discord does not know (deleted account) so it is not asked again. */
const UNKNOWN = '-';
/** Users asked from Discord per call at most; the rest stay unnamed until the next call. */
const MAX_FETCH = 50;
const PARALLEL = 5;

function cachedUser(raw: string | null): UserInfo | null | undefined {
  if (raw === UNKNOWN) return null;
  if (raw === null) return undefined;
  try {
    const parsed = UserInfo.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

/** Names of Discord users by ID — from Redis, otherwise from Discord REST (works without the gateway). */
export class UserDirectory {
  private readonly loading = new Map<string, Promise<UserInfo | null>>();
  constructor(
    private readonly redis: Redis,
    private readonly rest: REST,
  ) {}

  /** Known users of `ids`; non-snowflakes (`system`) and users Discord did not give are left out. */
  async resolve(ids: Iterable<string | null | undefined>, options: { fetchMissing?: boolean } = {}): Promise<Record<string, UserInfo>> {
    const { fetchMissing = true } = options;
    const unique = [...new Set([...ids].filter((id): id is string => !!id && Snowflake.safeParse(id).success))];
    if (unique.length === 0) return {};
    const result: Record<string, UserInfo> = {};
    const missing: string[] = [];
    const cached = await this.redis.mget(unique.map(RedisKeys.user));
    cached.forEach((raw, i) => {
      const id = unique[i]!;
      const info = cachedUser(raw);
      if (info === undefined) missing.push(id);
      else if (info) result[id] = info;
    });

    if (!fetchMissing || missing.length === 0) return result;

    const toFetch = missing.slice(0, MAX_FETCH);
    await eachLimit(toFetch, PARALLEL, async (id) => {
      const info = await this.fetchOnce(id);
      if (info) result[id] = info;
    });
    return result;
  }

  private fetchOnce(id: string): Promise<UserInfo | null> {
    let work = this.loading.get(id);
    if (!work) {
      work = (async () => {
        // A queued ID may have been loaded by another resolve() since the initial MGET.
        const cached = cachedUser(await this.redis.get(RedisKeys.user(id)));
        return cached === undefined ? this.fetch(id) : cached;
      })().finally(() => this.loading.delete(id));
      this.loading.set(id, work);
    }
    return work;
  }

  private async fetch(id: string): Promise<UserInfo | null> {
    try {
      const parsed = ApiUser.safeParse(await this.rest.get(Routes.user(id)));
      if (!parsed.success) return null;
      const info: UserInfo = { username: parsed.data.username, globalName: parsed.data.global_name ?? null, avatar: parsed.data.avatar ?? null };
      await this.redis.set(RedisKeys.user(id), JSON.stringify(info), 'EX', TTL_SEC);
      return info;
    } catch (err) {
      if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownUser) {
        await this.redis.set(RedisKeys.user(id), UNKNOWN, 'EX', TTL_SEC);
      }
      // Anything else (rate limit, outage) — the user stays unnamed this time.
      return null;
    }
  }
}
