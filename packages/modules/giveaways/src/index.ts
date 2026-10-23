import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits, Partials } from 'discord.js';
import { z } from 'zod';
import { giveawaysApi } from './api.js';
import { giveawayComponent } from './bot.js';
import { giveawayCommand } from './commands.js';
import { defaultGiveawaysConfig, GiveawaysConfig } from './config.js';
import { locales } from './locales.js';
import { GiveawayService, PREFIX } from './service.js';

export { GiveawayDto, GiveawayInput, GiveawaysConfig } from './config.js';

const EndPayload = z.object({ id: z.string() });

/** Giveaways: a button to enter, role and membership requirements, winners drawn on time, rerolls. */
export default defineModule({
  id: 'giveaways',
  configSchema: GiveawaysConfig,
  defaultConfig: defaultGiveawaysConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) => new EntityChecker(guild).roles(config.managerRoleIds, ['managerRoleIds']).issues,
  bot: {
    // Deleted giveaway messages arrive uncached — as partials.
    intents: [GatewayIntentBits.GuildMessages],
    partials: [Partials.Message],
    commands: [giveawayCommand],
    components: { [PREFIX]: giveawayComponent },
    // A giveaway whose message or channel is gone is cancelled: nobody can enter it, and its draw has nowhere to go.
    housekeeping: {
      messageDelete: async (ctx, message) => {
        if (message.guildId) await new GiveawayService(ctx).cancelGone(message.guildId, { messageId: message.id });
      },
      channelDelete: async (ctx, channel) => {
        if (!channel.isDMBased()) await new GiveawayService(ctx).cancelGone(channel.guildId, { channelId: channel.id });
      },
    },
  },
  jobs: {
    // A giveaway that ends while the module is off draws once it is on again.
    end: {
      whenDisabled: 'postpone',
      run: async (payload, ctx) => {
        const giveaway = await ctx.db.giveaway.findUnique({ where: { id: EndPayload.parse(payload).id } });
        if (giveaway?.status !== 'running') return;
        await new GiveawayService(ctx).end(giveaway, await ctx.getConfig(ctx.guildId));
      },
    },
  },
  api: giveawaysApi,
});
