import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { welcomeApi } from './api.js';
import { messageModalHandler, MODAL_PREFIX, welcomeCommand } from './commands/welcome.js';
import { defaultWelcomeConfig, WelcomeConfig } from './config.js';
import { greet } from './greet.js';
import { inviterVars, onInviteJoined } from './inviter.js';
import { locales } from './locales.js';

export { WelcomeConfig } from './config.js';

/** A member who joined before passing Membership Screening; the screening may take a while. */
const pendingKey = (guildId: string, userId: string) => `welcome:pending:${guildId}:${userId}`;
const PENDING_TTL_SEC = 7 * 86_400;

/** Welcome messages on join (to a channel and via DM) and farewells on leave. */
export default defineModule({
  id: 'welcome',
  configSchema: WelcomeConfig,
  defaultConfig: defaultWelcomeConfig,
  configVersion: 1,
  locales,
  localizeDefaults: (defaults, t) => ({
    ...defaults,
    join: { ...defaults.join, message: { content: t('defaults.join') } },
    joinDm: { ...defaults.joinDm, message: { content: t('defaults.dm') } },
    leave: { ...defaults.leave, message: { content: t('defaults.leave') } },
  }),
  validateConfig: (config, guild) =>
    new EntityChecker(guild).textChannel(config.join.channelId, ['join', 'channelId']).textChannel(config.leave.channelId, ['leave', 'channelId'])
      .issues,
  bot: {
    // Member join and leave events require the privileged Server Members intent.
    intents: [GatewayIntentBits.GuildMembers],
    commands: [welcomeCommand],
    components: { [MODAL_PREFIX]: messageModalHandler },
    // The inviter comes from the invites module over the bus.
    setup: (ctx) => ctx.bus.on('invites.joined', onInviteJoined),
    events: {
      guildMemberAdd: async (ctx, member) => {
        const config = await ctx.getConfig(member.guild.id);
        if (config.ignoreBots && member.user.bot) return;
        if (config.waitForScreening && member.pending) {
          // Greeted from guildMemberUpdate once the rules are accepted.
          await ctx.redis.set(pendingKey(member.guild.id, member.id), '1', 'EX', PENDING_TTL_SEC);
          return;
        }
        const vars = await inviterVars(ctx, member.guild.id, member.id, config);
        await greet('join', member, config, ctx.logger, { vars });
        await greet('dm', member, config, ctx.logger, { vars });
      },
      guildMemberUpdate: async (ctx, _oldMember, member) => {
        if (member.pending) return;
        // The marker is set only for members who joined pending — exactly one greeting per join.
        if (!(await ctx.redis.getdel(pendingKey(member.guild.id, member.id)))) return;
        const config = await ctx.getConfig(member.guild.id);
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
