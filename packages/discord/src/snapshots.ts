import { GuildChannel, GuildEmoji, GuildMeta, GuildRole } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { Guild } from 'discord.js';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { toGuildChannel, toGuildEmoji, toGuildMeta, toGuildRole } from './mappers.js';

/** Бот пишет снапшоты гильдий в Redis, чтобы API отдавал вебу каналы и роли без gateway. */
export class GuildSnapshotWriter {
  constructor(private readonly redis: Redis) {}

  async writeGuild(guild: Guild): Promise<void> {
    await this.redis
      .multi()
      .set(RedisKeys.guildMeta(guild.id), JSON.stringify(toGuildMeta(guild)))
      .set(RedisKeys.guildChannels(guild.id), JSON.stringify(guild.channels.cache.map(toGuildChannel)))
      .set(RedisKeys.guildRoles(guild.id), JSON.stringify(guild.roles.cache.map(toGuildRole)))
      .set(RedisKeys.guildEmojis(guild.id), JSON.stringify(guild.emojis.cache.map(toGuildEmoji)))
      .exec();
  }

  async writeMeta(guild: Guild): Promise<void> {
    await this.redis.set(RedisKeys.guildMeta(guild.id), JSON.stringify(toGuildMeta(guild)));
  }

  async writeChannels(guild: Guild): Promise<void> {
    await this.redis.set(RedisKeys.guildChannels(guild.id), JSON.stringify(guild.channels.cache.map(toGuildChannel)));
  }

  async writeRoles(guild: Guild): Promise<void> {
    await this.redis.set(RedisKeys.guildRoles(guild.id), JSON.stringify(guild.roles.cache.map(toGuildRole)));
  }

  async writeEmojis(guild: Guild): Promise<void> {
    await this.redis.set(RedisKeys.guildEmojis(guild.id), JSON.stringify(guild.emojis.cache.map(toGuildEmoji)));
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
