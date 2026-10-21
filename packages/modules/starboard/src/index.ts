import { defineModule, EntityChecker } from '@bot/core';
import { UserDirectory, UserInfo } from '@bot/discord';
import { GatewayIntentBits, Partials } from 'discord.js';
import { z } from 'zod';
import { onMessageDelete, onReaction } from './bot.js';
import { defaultStarboardConfig, StarboardConfig, StarboardEntryDto } from './config.js';
import { locales } from './locales.js';

export { StarboardConfig } from './config.js';

/** Messages that gather enough of the chosen reaction are copied to the starboard channel. */
export default defineModule({
  id: 'starboard',
  configSchema: StarboardConfig,
  defaultConfig: defaultStarboardConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) => new EntityChecker(guild).textChannel(config.channelId, ['channelId']).channels(config.ignoredChannelIds, ['ignoredChannelIds']).issues,
  bot: {
    intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent],
    // Reactions on messages from before the bot started arrive as partials.
    partials: [Partials.Message, Partials.Reaction, Partials.User],
    events: {
      messageReactionAdd: (ctx, reaction) => onReaction(ctx, reaction),
      messageReactionRemove: (ctx, reaction) => onReaction(ctx, reaction),
      messageDelete: onMessageDelete,
    },
  },
  api: (app, ctx) => {
    const users = new UserDirectory(ctx.redis, ctx.rest);
    app.get(
      '/top',
      {
        schema: {
          tags: ['starboard'],
          summary: 'Messages on the board, most stars first',
          response: { 200: z.object({ items: z.array(StarboardEntryDto), users: z.record(z.string(), UserInfo) }) },
        },
      },
      async (request) => {
        const rows = await ctx.db.starboardEntry.findMany({ where: { guildId: (request.params as { guildId: string }).guildId }, orderBy: { stars: 'desc' }, take: 25 });
        return {
          items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
          users: await users.resolve(rows.map((r) => r.authorId)),
        };
      },
    );
  },
});
