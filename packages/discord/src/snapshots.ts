import { GuildChannel, GuildEmoji, GuildMeta, GuildRole } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { Guild } from 'discord.js';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { toGuildChannel, toGuildEmoji, toGuildMeta, toGuildRole } from './mappers.js';

export const SNAPSHOT_TTL_SEC = 7 * 24 * 3600;

/** The bot writes guild snapshots to Redis so the API can serve channels and roles without the gateway. */
export class GuildSnapshotWriter {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = SNAPSHOT_TTL_SEC,
  ) {}

  async writeGuild(guild: Guild): Promise<void> {
    await this.redis
      .multi()
      .set(RedisKeys.guildMeta(guild.id), JSON.stringify(toGuildMeta(guild)), 'EX', this.ttlSec)
      .set(RedisKeys.guildChannels(guild.id), JSON.stringify(guild.channels.cache.map(toGuildChannel)), 'EX', this.ttlSec)
      .set(RedisKeys.guildRoles(guild.id), JSON.stringify(guild.roles.cache.map(toGuildRole)), 'EX', this.ttlSec)
      .set(RedisKeys.guildEmojis(guild.id), JSON.stringify(guild.emojis.cache.map(toGuildEmoji)), 'EX', this.ttlSec)
      .exec();
  }

  async writeMeta(guild: Guild): Promise<void> {
    await this.redis.set(RedisKeys.guildMeta(guild.id), JSON.stringify(toGuildMeta(guild)), 'EX', this.ttlSec);
  }

  async writeChannels(guild: Guild): Promise<void> {
    await this.redis.set(RedisKeys.guildChannels(guild.id), JSON.stringify(guild.channels.cache.map(toGuildChannel)), 'EX', this.ttlSec);
  }

  async writeRoles(guild: Guild): Promise<void> {
    await this.redis.set(RedisKeys.guildRoles(guild.id), JSON.stringify(guild.roles.cache.map(toGuildRole)), 'EX', this.ttlSec);
  }

  async writeEmojis(guild: Guild): Promise<void> {
    await this.redis.set(RedisKeys.guildEmojis(guild.id), JSON.stringify(guild.emojis.cache.map(toGuildEmoji)), 'EX', this.ttlSec);
  }

  async removeGuild(guildId: string): Promise<void> {
    await this.redis.del(
      RedisKeys.guildMeta(guildId),
      RedisKeys.guildChannels(guildId),
      RedisKeys.guildRoles(guildId),
      RedisKeys.guildEmojis(guildId),
    );
  }
}

export class GuildSnapshotReader {
  constructor(private readonly redis: Redis) {}

  async isPresent(guildId: string): Promise<boolean> {
    return (await this.redis.exists(RedisKeys.guildMeta(guildId))) === 1;
  }

  /** `isPresent` for many guilds in one round trip, in their order. */
  async presentMany(guildIds: readonly string[]): Promise<boolean[]> {
    if (guildIds.length === 0) return [];
    const pipeline = this.redis.pipeline();
    for (const id of guildIds) pipeline.exists(RedisKeys.guildMeta(id));
    const results = (await pipeline.exec()) ?? [];
    return guildIds.map((_, i) => results[i]?.[1] === 1);
  }

  getMeta(guildId: string): Promise<GuildMeta | null> {
    return this.read(RedisKeys.guildMeta(guildId), GuildMeta);
  }

  getChannels(guildId: string): Promise<GuildChannel[] | null> {
    return this.read(RedisKeys.guildChannels(guildId), z.array(GuildChannel));
  }

  getRoles(guildId: string): Promise<GuildRole[] | null> {
    return this.read(RedisKeys.guildRoles(guildId), z.array(GuildRole));
  }

  getEmojis(guildId: string): Promise<GuildEmoji[] | null> {
    return this.read(RedisKeys.guildEmojis(guildId), z.array(GuildEmoji));
  }

  private async read<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw === null ? null : schema.parse(JSON.parse(raw));
  }
}
