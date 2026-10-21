import { defineComponent } from '@bot/core';
import { MessageFlags, PermissionFlagsBits, type GuildMember } from 'discord.js';
import { z } from 'zod';
import type { GiveawaysConfig } from './config.js';
import { GiveawayService } from './service.js';

const Ids = z.array(z.string());

/** Why the member cannot enter: a required role missing, too new on the server; `null` — they can. */
export function entryProblem(
  member: Pick<GuildMember, 'joinedTimestamp'> & { roles: { cache: { has(id: string): boolean } } },
  requirements: { requiredRoleIds: readonly string[]; minMemberDays: number },
  now = Date.now(),
): { key: string; vars?: Record<string, string | number> } | null {
  const missing = requirements.requiredRoleIds.filter((id) => !member.roles.cache.has(id));
  if (missing.length > 0) return { key: 'giveaways.needRoles', vars: { roles: missing.map((id) => `<@&${id}>`).join(', ') } };
  const days = member.joinedTimestamp ? (now - member.joinedTimestamp) / 86_400_000 : 0;
  if (days < requirements.minMemberDays) return { key: 'giveaways.tooNew', vars: { days: requirements.minMemberDays } };
  return null;
}

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
