import { defineModule, EntityChecker } from '@bot/core';
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
    commands: [giveawayCommand],
    components: { [PREFIX]: giveawayComponent },
  },
  jobs: {
    end: async (payload, ctx) => {
      const giveaway = await ctx.db.giveaway.findUnique({ where: { id: EndPayload.parse(payload).id } });
      if (giveaway?.status !== 'running') return;
      await new GiveawayService(ctx).end(giveaway, await ctx.getConfig(ctx.guildId));
    },
  },
  api: giveawaysApi,
});
