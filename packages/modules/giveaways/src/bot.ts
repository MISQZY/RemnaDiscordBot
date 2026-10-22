import { defineComponent } from '@bot/core';
import { MessageFlags, PermissionFlagsBits, type GuildMember } from 'discord.js';
import { z } from 'zod';
import type { GiveawaysConfig } from './config.js';
import { entryProblem } from './eligibility.js';
import { GiveawayService } from './service.js';

export { entryProblem };

const Ids = z.array(z.string());

/** May start and end giveaways: Manage Server, or a manager role. */
export const isManager = (member: GuildMember, config: GiveawaysConfig) =>
  member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.some((r) => config.managerRoleIds.includes(r.id));

/** The entry button; the message's count is refreshed at most every few seconds. */
export const giveawayComponent = defineComponent<GiveawaysConfig>({
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, , id] = interaction.customId.split(':');
    const reply = (key: string, vars?: Record<string, string | number>) =>
      interaction.reply({ content: ctx.t(key, vars), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    const giveaway = id ? await ctx.db.giveaway.findUnique({ where: { id } }) : null;
    if (!giveaway || giveaway.guildId !== interaction.guildId || giveaway.status !== 'running' || giveaway.endsAt.getTime() < Date.now()) {
      return void (await reply('giveaways.over'));
    }
    const problem = entryProblem(interaction.member, { requiredRoleIds: Ids.parse(giveaway.requiredRoleIds), minMemberDays: giveaway.minMemberDays });
    if (problem) return void (await reply(problem.key, problem.vars));

    const service = new GiveawayService(ctx);
    const entered = await service.toggleEntry(giveaway, interaction.user.id);
    await reply(entered ? 'giveaways.entered' : 'giveaways.left');

    if (await ctx.redis.set(`giveaways:refresh:${giveaway.id}`, '1', 'EX', 5, 'NX')) {
      const fresh = await ctx.db.giveaway.findUnique({ where: { id: giveaway.id } });
      if (fresh) await service.refresh(fresh, await ctx.getConfig(interaction.guildId));
    }
  },
});
