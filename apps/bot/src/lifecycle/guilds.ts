import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotWriter } from '@bot/discord';
import type { Logger } from '@bot/logger';
import { Events, type Client, type Guild } from 'discord.js';

/**
 * Платформенная часть, не зависящая от модулей: учёт гильдий в БД
 * и актуальность снапшотов каналов/ролей/эмодзи для API.
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
    // Права бота на роли зависят от его собственных ролей.
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
      create: { id: guild.id },
      update: { leftAt: null },
    });
    await this.snapshots.writeGuild(guild);
    this.logger.info({ guildId: guild.id, name: guild.name }, 'Joined guild');
  }

  async leave(guild: Guild): Promise<void> {
    // Недоступная гильдия — сбой Discord, а не удаление бота.
    if (!guild.available) return;
    await this.db.guild.updateMany({ where: { id: guild.id }, data: { leftAt: new Date() } });
    await this.snapshots.removeGuild(guild.id);
    this.logger.info({ guildId: guild.id }, 'Left guild');
  }

  /** При старте кластера: гильдии могли добавиться, пока бот был выключен. */
  async syncAll(guilds: Guild[]): Promise<void> {
    for (const guild of guilds) {
      await this.db.guild.upsert({ where: { id: guild.id }, create: { id: guild.id }, update: { leftAt: null } });
      await this.snapshots.writeGuild(guild);
    }
    this.logger.info({ guilds: guilds.length }, 'Guilds synced');
  }

  private safe(label: string, task: () => Promise<unknown>): void {
    task().catch((err: unknown) => this.logger.error({ err, label }, 'Guild lifecycle task failed'));
  }
}
