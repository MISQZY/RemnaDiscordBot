import { eachLimit, type CoreServices, type ModuleServices } from '@bot/core';
import { renderText } from '@bot/templates';
import { ChannelType, DiscordAPIError, OverwriteType, PermissionFlagsBits, RESTJSONErrorCodes, Routes, type APIChannel, type APIGuild } from 'discord.js';
import type { ServerStatsConfig } from './config.js';

type Services = Pick<CoreServices, 'rest' | 'logger' | 'redis'>;

/** Discord renames a channel at most twice in ten minutes: one rename per channel in five keeps within it. */
export const RENAME_EVERY_SEC = 300;
const renamedKey = (channelId: string) => `server-stats:renamed:${channelId}`;
/** The name the bot last gave a counter: known, the channel list is not needed to see whether it changed. */
const nameKey = (channelId: string) => `server-stats:name:${channelId}`;
const NAME_TTL_SEC = 7 * 86_400;
/** A counter whose channel is gone is left alone for a while instead of failing every run. */
const GONE_SEC = 3600;
/** Servers updated at once: each is a call or two to Discord. */
const CONCURRENCY = 5;

export type Stats = Record<'members' | 'online' | 'boosts' | 'boostTier' | 'channels' | 'roles', number>;

/** The server's numbers from REST: approximate counts Discord gives without any gateway data. */
export async function readStats(services: Services, guildId: string, withChannels: boolean): Promise<{ stats: Stats; channels: APIChannel[] }> {
  const guild = (await services.rest.get(Routes.guild(guildId), { query: new URLSearchParams({ with_counts: 'true' }) })) as APIGuild & {
    approximate_member_count?: number;
    approximate_presence_count?: number;
  };
  const channels = withChannels ? ((await services.rest.get(Routes.guildChannels(guildId))) as APIChannel[]) : [];
  return {
    stats: {
      members: guild.approximate_member_count ?? 0,
      online: guild.approximate_presence_count ?? 0,
      boosts: guild.premium_subscription_count ?? 0,
      boostTier: guild.premium_tier,
      channels: channels.filter((c) => c.type !== ChannelType.GuildCategory).length,
      roles: Math.max(0, guild.roles.length - 1),
    },
    channels,
  };
}

/** A counter's name with the numbers put in. */
export const counterName = (template: string, stats: Stats) => renderText(template, stats).slice(0, 100);

/**
 * Renames the counter channels whose numbers changed, each at most once in RENAME_EVERY_SEC — a rename past Discord's
 * limit would wait in the REST queue for minutes. A changed number of a channel renamed just now waits for the next run.
 *
 * Calls to Discord are kept down: counters all waiting out their limit cost nothing; otherwise one call for the
 * numbers, and the channel list only for `{channels}` or a counter whose name the bot does not remember.
 */
export async function updateCounters(services: Services, guildId: string, config: ServerStatsConfig): Promise<number> {
  if (config.counters.length === 0) return 0;
  const waiting = await services.redis.mget(...config.counters.map((c) => renamedKey(c.channelId)));
  const due = config.counters.filter((_, i) => waiting[i] === null);
  if (due.length === 0) return 0;
  const known = await services.redis.mget(...due.map((c) => nameKey(c.channelId)));
  const listChannels = due.some((c, i) => known[i] === null || c.template.includes('{channels}'));
  const { stats, channels } = await readStats(services, guildId, listChannels);
  const listed = new Map(channels.map((c) => [c.id, 'name' in c ? c.name : null]));

  let renamed = 0;
  for (const [i, counter] of due.entries()) {
    const name = counterName(counter.template, stats);
    const current = known[i] ?? listed.get(counter.channelId);
    if (current === undefined || current === name) {
      if (current === name) await services.redis.set(nameKey(counter.channelId), name, 'EX', NAME_TTL_SEC);
      continue;
    }
    if (!(await services.redis.set(renamedKey(counter.channelId), '1', 'EX', RENAME_EVERY_SEC, 'NX'))) continue;
    try {
      await services.rest.patch(Routes.channel(counter.channelId), { body: { name }, reason: 'Server stats' });
      await services.redis.set(nameKey(counter.channelId), name, 'EX', NAME_TTL_SEC);
      renamed++;
    } catch (err) {
      if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownChannel) {
        await services.redis.multi().del(nameKey(counter.channelId)).set(renamedKey(counter.channelId), '1', 'EX', GONE_SEC).exec();
      } else {
        services.logger.warn({ err, guildId, channelId: counter.channelId }, 'Counter not renamed');
      }
    }
  }
  return renamed;
}

/** A locked voice channel for a counter: visible to everyone, nobody can join. */
export async function createCounterChannel(services: Services, guildId: string, template: string, parentId: string | null): Promise<string> {
  const { stats } = await readStats(services, guildId, template.includes('{channels}'));
  const channel = (await services.rest.post(Routes.guildChannels(guildId), {
    body: {
      name: counterName(template, stats),
      type: ChannelType.GuildVoice,
      parent_id: parentId,
      permission_overwrites: [{ id: guildId, type: OverwriteType.Role, deny: PermissionFlagsBits.Connect.toString() }],
    },
    reason: 'Server stats counter',
  })) as { id: string };
  return channel.id;
}

/** Worker: counters of every server where the module is on, a few servers at a time. */
export async function updateAll(ctx: ModuleServices<ServerStatsConfig>): Promise<void> {
  const rows = await ctx.db.guildModuleConfig.findMany({ where: { moduleId: 'server-stats', enabled: true }, select: { guildId: true } });
  await eachLimit(rows, CONCURRENCY, async ({ guildId }) => {
    try {
      await updateCounters(ctx, guildId, await ctx.getConfig(guildId));
    } catch (err) {
      ctx.logger.warn({ err, guildId }, 'Server stats update failed');
    }
  });
}
