import { Snowflake } from '@bot/contracts';
import { defineModule, HttpError } from '@bot/core';
import { z } from 'zod';
import { defaultServerStatsConfig, ServerStatsConfig } from './config.js';
import { locales } from './locales.js';
import { counterName, createCounterChannel, deleteRemovedCounters, dropDeletedCounter, readStats, RENAME_EVERY_SEC, updateAll, updateCounters } from './service.js';

export { ServerStatsConfig, STAT_PLACEHOLDERS } from './config.js';

/** A manual refresh at most this often; each channel keeps its own rename limit anyway. */
const REFRESH_COOLDOWN_SEC = 30;

/**
 * Channels whose names show the server's numbers: members, online, boosts… The worker checks every minute, so a saved
 * counter gets its name right away; each channel is renamed at most once in five minutes (Discord's limit).
 */
export default defineModule({
  id: 'server-stats',
  configSchema: ServerStatsConfig,
  defaultConfig: defaultServerStatsConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) => {
    const ids = new Set(guild.channels.map((c) => c.id));
    return config.counters.flatMap((c, i) => (ids.has(c.channelId) ? [] : [{ path: ['counters', i, 'channelId'], message: `Channel ${c.channelId} not found` }]));
  },
  // A counter is renamed at most every RENAME_EVERY_SEC anyway: checking more often only spends calls.
  intervals: { counters: { everyMs: RENAME_EVERY_SEC * 1000, run: updateAll } },
  bot: {
    housekeeping: {
      channelDelete: async (ctx, channel) => {
        if (!channel.isDMBased()) await dropDeletedCounter(ctx, channel.guildId, channel.id);
      },
    },
  },
  onSaved: (ctx, { guildId, before, after }) => deleteRemovedCounters(ctx, guildId, before.config, after.config),
  api: (app, ctx) => {
    const guildId = (request: { params: unknown }) => (request.params as { guildId: string }).guildId;

    app.get(
      '/preview',
      {
        schema: {
          tags: ['server-stats'],
          summary: 'The numbers now and how the counters read',
          response: { 200: z.object({ stats: z.record(z.string(), z.number()), names: z.array(z.string()) }) },
        },
      },
      async (request) => {
        const config = await ctx.getConfig(guildId(request));
        const { stats } = await readStats(ctx, guildId(request), true);
        return { stats, names: config.counters.map((c) => counterName(c.template, stats)) };
      },
    );

    app.post(
      '/channels',
      {
        schema: {
          tags: ['server-stats'],
          summary: 'Create a locked voice channel for a counter; add it to the config to keep it updated',
          body: z.object({ template: z.string().trim().min(1).max(100), parentId: Snowflake.nullable().default(null) }),
          response: { 201: z.object({ channelId: Snowflake }) },
        },
      },
      async (request, reply) => {
        const { template, parentId } = request.body as { template: string; parentId: string | null };
        await ctx.requireEnabled(guildId(request));
        return reply.status(201).send({ channelId: await createCounterChannel(ctx, guildId(request), template, parentId) });
      },
    );

    app.post(
      '/refresh',
      { schema: { tags: ['server-stats'], summary: 'Update the counters now; a channel renamed in the last five minutes waits', response: { 200: z.object({ renamed: z.number().int() }) } } },
      async (request) => {
        const id = guildId(request);
        await ctx.requireEnabled(id);
        if (!(await ctx.redis.set(`server-stats:refresh:${id}`, '1', 'EX', REFRESH_COOLDOWN_SEC, 'NX'))) throw HttpError.tooManyRequests('Counters were updated recently');
        return { renamed: await updateCounters(ctx, id, await ctx.getConfig(id)) };
      },
    );
  },
});
