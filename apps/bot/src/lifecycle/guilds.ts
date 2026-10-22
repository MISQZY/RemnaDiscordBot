import { SUPPORTED_LOCALES, type Locale } from '@bot/contracts';
import { eachLimit } from '@bot/core';
import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotWriter } from '@bot/discord';
import type { Logger } from '@bot/logger';
import { Events, type Client, type Guild } from 'discord.js';

/**
 * A new server's language comes from its Discord settings; English if the bot does not support it.
 * A language chosen later (`/language`, API) is never overwritten.
 */
export function initialLocale(guild: Pick<Guild, 'preferredLocale'>): Locale {
  const base = guild.preferredLocale?.split('-')[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base ?? '') ? (base as Locale) : 'en';
}

/**
 * Module-independent platform part: tracks guilds in the database
 * and keeps channel/role/emoji snapshots fresh for the API.
 */
export class GuildLifecycle {
  constructor(
    private readonly db: PrismaClient,
    private readonly snapshots: GuildSnapshotWriter,
    private readonly logger: Logger,
  ) {}

  attach(client: Client): void {
    client.once(Events.ClientReady, (ready) => this.safe('ready', () => this.syncAll([...ready.guilds.cache.values()])));
    client.on(Events.GuildCreate, (guild) => this.safe('guildCreate', () => this.join(guild)));
    client.on(Events.GuildDelete, (guild) => this.safe('guildDelete', () => this.leave(guild)));
    client.on(Events.GuildUpdate, (_, guild) => this.safe('guildUpdate', () => this.snapshots.writeMeta(guild)));

    const channels = (channel: { guild?: Guild }) =>
      channel.guild && this.safe('channels', () => this.snapshots.writeChannels(channel.guild!));
    client.on(Events.ChannelCreate, channels);
    client.on(Events.ChannelUpdate, (_, channel) => channels(channel as { guild?: Guild }));
    client.on(Events.ChannelDelete, (channel) => channels(channel as { guild?: Guild }));

    const roles = (guild: Guild) => this.safe('roles', () => this.snapshots.writeRoles(guild));
    client.on(Events.GuildRoleCreate, (role) => roles(role.guild));
    client.on(Events.GuildRoleUpdate, (_, role) => roles(role.guild));
    client.on(Events.GuildRoleDelete, (role) => roles(role.guild));
    // The bot's ability to manage roles depends on its own roles.
    client.on(Events.GuildMemberUpdate, (_, member) => {
      if (member.id === client.user?.id) roles(member.guild);
    });

    const emojis = (guild: Guild) => this.safe('emojis', () => this.snapshots.writeEmojis(guild));
    client.on(Events.GuildEmojiCreate, (emoji) => emojis(emoji.guild));
    client.on(Events.GuildEmojiUpdate, (_, emoji) => emojis(emoji.guild));
    client.on(Events.GuildEmojiDelete, (emoji) => emojis(emoji.guild));
  }

  async join(guild: Guild): Promise<void> {
    await this.db.guild.upsert({
      where: { id: guild.id },
      create: { id: guild.id, locale: initialLocale(guild) },
      update: { leftAt: null },
    });
    await this.snapshots.writeGuild(guild);
    this.logger.info({ guildId: guild.id, name: guild.name }, 'Joined guild');
  }

  async leave(guild: Guild): Promise<void> {
    // An unavailable guild is a Discord outage, not the bot being removed.
    if (!guild.available) return;
    await this.db.guild.updateMany({ where: { id: guild.id }, data: { leftAt: new Date() } });
    await this.snapshots.removeGuild(guild.id);
    this.logger.info({ guildId: guild.id }, 'Left guild');
  }

  /** On cluster startup: guilds may have been added while the bot was offline. */
  async syncAll(guilds: Guild[]): Promise<void> {
    // A few at a time: one by one, a cluster of thousands of guilds takes minutes to be ready for the dashboard.
    await eachLimit(guilds, 10, async (guild) => {
      await this.db.guild.upsert({
        where: { id: guild.id },
        create: { id: guild.id, locale: initialLocale(guild) },
        update: { leftAt: null },
      });
      await this.snapshots.writeGuild(guild);
    });
    this.logger.info({ guilds: guilds.length }, 'Guilds synced');
  }

  private safe(label: string, task: () => Promise<unknown>): void {
    task().catch((err: unknown) => this.logger.error({ err, label }, 'Guild lifecycle task failed'));
  }
}
