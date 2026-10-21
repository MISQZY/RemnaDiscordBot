import { defineModule, EntityChecker } from '@bot/core';
import { UserDirectory, UserInfo } from '@bot/discord';
import { GatewayIntentBits } from 'discord.js';
import { z } from 'zod';
import { onInviteCreate, onInviteDelete, onMemberJoin, onMemberLeave, onReady, snapshot } from './bot.js';
import { invitesCommand } from './commands.js';
import { defaultInvitesConfig, InviteCounts, InvitesConfig } from './config.js';
import { locales } from './locales.js';
import { countsOf, leaderboard } from './service.js';

export { InviteCounts, InvitesConfig } from './config.js';

// In the entry point, so the declarations of the built package carry it to the modules that listen.
declare module '@bot/core' {
  interface BusEvents {
    /** A member joined and the inviter is known (or not): welcome waits for it to fill `{inviter}`. */
    'invites.joined': { guildId: string; userId: string; inviterId: string | null; code: string | null; invites: number };
  }
}

/** Who invited whom: counts, a leaderboard, roles for invites and `{inviter}` in welcome messages. */
export default defineModule({
  id: 'invites',
  configSchema: InvitesConfig,
  defaultConfig: defaultInvitesConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) =>
    new EntityChecker(guild).textChannel(config.logChannelId, ['logChannelId']).roles(
      config.rewards.map((r) => r.roleId),
      ['rewards'],
      { assignable: true },
    ).issues,
  bot: {
    intents: [GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildMembers],
    commands: [invitesCommand],
    events: {
      clientReady: onReady,
      guildCreate: (ctx, guild) => snapshot(ctx, guild),
      inviteCreate: onInviteCreate,
      inviteDelete: onInviteDelete,
      guildMemberAdd: onMemberJoin,
      guildMemberRemove: onMemberLeave,
    },
  },
  api: (app, ctx) => {
    const users = new UserDirectory(ctx.redis, ctx.rest);
    const guildId = (request: { params: unknown }) => (request.params as { guildId: string }).guildId;

    app.get(
      '/leaderboard',
      {
        schema: {
          tags: ['invites'],
          summary: 'Inviters by counted invites',
          querystring: z.object({ offset: z.coerce.number().int().min(0).default(0) }),
          response: { 200: z.object({ items: z.array(InviteCounts), users: z.record(z.string(), UserInfo) }) },
        },
      },
      async (request) => {
        const { offset } = request.query as { offset: number };
        const items = await leaderboard(ctx, guildId(request), await ctx.getConfig(guildId(request)), 25, offset);
        return { items, users: await users.resolve(items.map((i) => i.userId)) };
      },
    );

    app.get(
      '/members/:userId',
      { schema: { tags: ['invites'], summary: "A member's invite counts", params: z.object({ guildId: z.string(), userId: z.string() }), response: { 200: InviteCounts } } },
      async (request) => countsOf(ctx, guildId(request), (request.params as { userId: string }).userId, await ctx.getConfig(guildId(request))),
    );
  },
});
