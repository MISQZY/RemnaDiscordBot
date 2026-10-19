import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { welcomeApi } from './api.js';
import { welcomeCommand } from './commands/welcome.js';
import { defaultWelcomeConfig, WelcomeConfig } from './config.js';
import { greet } from './greet.js';
import { locales } from './locales.js';

export { WelcomeConfig } from './config.js';

/** Приветствия при входе (в канал и в ЛС) и прощания при выходе. */
export default defineModule({
  id: 'welcome',
  configSchema: WelcomeConfig,
  defaultConfig: defaultWelcomeConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) =>
    new EntityChecker(guild).textChannel(config.join.channelId, ['join', 'channelId']).textChannel(config.leave.channelId, ['leave', 'channelId'])
      .issues,
  bot: {
    // События входа и выхода участников требуют привилегированного intent Server Members.
    intents: [GatewayIntentBits.GuildMembers],
    commands: [welcomeCommand],
    events: {
      guildMemberAdd: async (ctx, member) => {
        const config = await ctx.getConfig(member.guild.id);
        if (config.ignoreBots && member.user.bot) return;
        await greet('join', member, config, ctx.logger);
        await greet('dm', member, config, ctx.logger);
      },
      guildMemberRemove: async (ctx, member) => {
        const config = await ctx.getConfig(member.guild.id);
        if (config.ignoreBots && member.user.bot) return;
        await greet('leave', member, config, ctx.logger);
      },
    },
  },
  api: welcomeApi,
});
