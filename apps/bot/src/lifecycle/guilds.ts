import { SUPPORTED_LOCALES, type Locale } from '@bot/contracts';
import { eachLimit } from '@bot/core';
import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotWriter } from '@bot/discord';
import type { Logger } from '@bot/logger';
import { Events, type Client, type ClientEvents, type Guild } from 'discord.js';

export const SNAPSHOT_REFRESH_MS = 24 * 60 * 60_000;
const SNAPSHOT_BATCH_MS = 50;
type SnapshotPart = 'meta' | 'channels' | 'roles' | 'emojis';

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

  attach(client: Client): () => void {
    const detach: (() => void)[] = [];
    const on = <K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => void) => {
      client.on(event, listener);
      detach.push(() => { client.off(event, listener); });
    };
    const pending = new Map<string, { guild: Guild; parts: Set<SnapshotPart>; timer: NodeJS.Timeout }>();
    const writes: Record<SnapshotPart, (guild: Guild) => Promise<void>> = {
      meta: (guild) => this.snapshots.writeMeta(guild), channels: (guild) => this.snapshots.writeChannels(guild),
      roles: (guild) => this.snapshots.writeRoles(guild), emojis: (guild) => this.snapshots.writeEmojis(guild),
    };
    const cancel = (guildId: string) => {
      const job = pending.get(guildId);
      if (job) clearTimeout(job.timer);
      pending.delete(guildId);
    };
    const queue = (guild: Guild, part: SnapshotPart) => {
      const existing = pending.get(guild.id);
      if (existing) { existing.guild = guild; existing.parts.add(part); return; }
      const job = { guild, parts: new Set([part]), timer: setTimeout(() => {
        pending.delete(guild.id);
        for (const changed of job.parts) this.safe(changed, () => writes[changed](job.guild));
      }, SNAPSHOT_BATCH_MS).unref() };
      pending.set(guild.id, job);
    };
    const ready = (ready: Client<true>) => this.safe('ready', () => this.syncAll([...ready.guilds.cache.values()]));
    client.once(Events.ClientReady, ready);
    detach.push(() => { client.off(Events.ClientReady, ready); });
    on(Events.GuildCreate, (guild) => this.safe('guildCreate', () => this.join(guild)));
    on(Events.GuildDelete, (guild) => { cancel(guild.id); this.safe('guildDelete', () => this.leave(guild)); });
    on(Events.GuildUpdate, (_, guild) => queue(guild, 'meta'));

    const channels = (channel: { guild?: Guild }) =>
      channel.guild && queue(channel.guild, 'channels');
    on(Events.ChannelCreate, channels);
    on(Events.ChannelUpdate, (_, channel) => channels(channel as { guild?: Guild }));
    on(Events.ChannelDelete, (channel) => channels(channel as { guild?: Guild }));

    const roles = (guild: Guild) => queue(guild, 'roles');
    on(Events.GuildRoleCreate, (role) => roles(role.guild));
    on(Events.GuildRoleUpdate, (_, role) => roles(role.guild));
    on(Events.GuildRoleDelete, (role) => roles(role.guild));
    // The bot's ability to manage roles depends on its own roles.
    on(Events.GuildMemberUpdate, (_, member) => {
      if (member.id === client.user?.id) roles(member.guild);
    });

    const emojis = (guild: Guild) => queue(guild, 'emojis');
    on(Events.GuildEmojiCreate, (emoji) => emojis(emoji.guild));
    on(Events.GuildEmojiUpdate, (_, emoji) => emojis(emoji.guild));
    on(Events.GuildEmojiDelete, (emoji) => emojis(emoji.guild));

    // Refresh even unchanged guilds before their seven-day Redis TTL expires.
    let refreshing = false;
    const timer = setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      this.safe('snapshots', async () => {
        try {
          await eachLimit([...client.guilds.cache.values()], 10, async (guild) => {
            if (!guild.available) return;
            try {
              await this.snapshots.writeGuild(guild);
            } catch (err) {
              this.logger.error({ err, guildId: guild.id }, 'Guild snapshot refresh failed');
            }
          });
        } finally {
          refreshing = false;
        }
      });
    }, SNAPSHOT_REFRESH_MS);
    timer.unref();
    return () => {
      clearInterval(timer);
      for (const job of pending.values()) clearTimeout(job.timer);
      pending.clear();
      for (const remove of detach) remove();
    };
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
    // Do not rewrite every existing guild and its updatedAt merely because a cluster restarted.
    for (let offset = 0; offset < guilds.length; offset += 500) {
      const batch = guilds.slice(offset, offset + 500);
      const rows = await this.db.guild.findMany({ where: { id: { in: batch.map((guild) => guild.id) } }, select: { id: true, leftAt: true } });
      const known = new Set(rows.map((row) => row.id));
      const missing = batch.filter((guild) => !known.has(guild.id));
      const rejoined = rows.filter((row) => row.leftAt !== null).map((row) => row.id);
      if (rejoined.length) await this.db.guild.updateMany({ where: { id: { in: rejoined }, leftAt: { not: null } }, data: { leftAt: null } });
      if (missing.length) {
        try {
          await this.db.guild.createMany({ data: missing.map((guild) => ({ id: guild.id, locale: initialLocale(guild) })) });
        } catch (err) {
          // A concurrent API request or cluster may have created a missing row since the batch was read.
          if (typeof err !== 'object' || err === null || !('code' in err) || err.code !== 'P2002') throw err;
          await eachLimit(missing, 10, async (guild) => {
            await this.db.guild.upsert({ where: { id: guild.id }, create: { id: guild.id, locale: initialLocale(guild) }, update: { leftAt: null } });
          });
        }
      }
      await eachLimit(batch, 10, (guild) => this.snapshots.writeGuild(guild));
    }
    this.logger.info({ guilds: guilds.length }, 'Guilds synced');
  }

  private safe(label: string, task: () => Promise<unknown>): void {
    task().catch((err: unknown) => this.logger.error({ err, label }, 'Guild lifecycle task failed'));
  }
}
