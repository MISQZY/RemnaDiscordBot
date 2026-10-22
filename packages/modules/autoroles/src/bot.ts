import { defineComponent, type BotModuleContext } from '@bot/core';
import { assignableRoleIds, changeMemberRoles, memberTemplateVars } from '@bot/discord';
import { channelVars, renderMessage } from '@bot/templates';
import { MessageFlags, roleMention, type GuildMember, type PartialGuildMember } from 'discord.js';
import type { AutorolesConfig } from './config.js';
import { toInfoPanel } from './info-panel.js';
import { computeRoleChanges, toPanel } from './panel.js';
import { persistedRoles } from './persistence.js';

const REASON = 'Autoroles';

/** Only roles the bot may hand out (below its role, not managed, no moderator permissions). */
const assignable = (member: GuildMember, roleIds: readonly string[]) => assignableRoleIds(member.guild, roleIds);

export const joinRolesKey = (guildId: string, userId: string) => `autoroles:join:${guildId}:${userId}`;
/** A member who joined before accepting the rules (Membership Screening); it may take days. */
const pendingKey = (guildId: string, userId: string) => `autoroles:pending:${guildId}:${userId}`;
const PENDING_TTL_SEC = 7 * 86_400;

export async function onMemberJoin(ctx: BotModuleContext<AutorolesConfig>, member: GuildMember): Promise<void> {
  const config = await ctx.getConfig(member.guild.id);

  if (config.persistence.enabled) {
    const backup = await ctx.db.memberRoleBackup.findUnique({
      where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
    });
    if (backup) {
      const roles = assignable(member, persistedRoles(backup.roleIds as string[], config.persistence));
      await changeMemberRoles(member, { add: roles }, `${REASON}: restore roles`);
      await ctx.db.memberRoleBackup.delete({ where: { guildId_userId: { guildId: member.guild.id, userId: member.id } } });
    }
  }

  if (config.joinRoles.waitForScreening && member.pending) {
    // Granted from guildMemberUpdate once the rules are accepted.
    await ctx.redis.set(pendingKey(member.guild.id, member.id), '1', 'EX', PENDING_TTL_SEC);
    return;
  }
  await grantJoinRoles(ctx, member, config);
}

/** The rules were accepted: the join roles held back for it are granted now. */
export async function onMemberUpdate(ctx: BotModuleContext<AutorolesConfig>, _old: GuildMember | PartialGuildMember, member: GuildMember): Promise<void> {
  if (member.pending) return;
  if (!(await ctx.redis.getdel(pendingKey(member.guild.id, member.id)))) return;
  await grantJoinRoles(ctx, member, await ctx.getConfig(member.guild.id));
}

async function grantJoinRoles(ctx: BotModuleContext<AutorolesConfig>, member: GuildMember, config: AutorolesConfig): Promise<void> {
  const joinRoles = assignable(member, member.user.bot ? config.joinRoles.bots : config.joinRoles.humans);
  if (joinRoles.length === 0) return;

  if (config.joinRoles.delaySec === 0) {
    await changeMemberRoles(member, { add: joinRoles }, `${REASON}: join roles`);
    return;
  }
  await ctx.scheduler.schedule({
    guildId: member.guild.id,
    moduleId: 'autoroles',
    job: 'assignJoinRoles',
    payload: { userId: member.id, roleIds: joinRoles },
    runAt: new Date(Date.now() + config.joinRoles.delaySec * 1000),
    key: joinRolesKey(member.guild.id, member.id),
  });
}

export async function onMemberLeave(ctx: BotModuleContext<AutorolesConfig>, member: GuildMember | PartialGuildMember): Promise<void> {
  // Left before the delayed grant — the job is no longer needed.
  await ctx.scheduler.cancel(joinRolesKey(member.guild.id, member.id));

  const config = await ctx.getConfig(member.guild.id);
  if (!config.persistence.enabled || member.partial) return;

  const roleIds = persistedRoles(
    member.roles.cache.filter((role) => role.id !== member.guild.id && !role.managed).map((role) => role.id),
    config.persistence,
  );
  if (roleIds.length === 0) return;
  await ctx.db.memberRoleBackup.upsert({
    where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
    create: { guildId: member.guild.id, userId: member.id, roleIds },
    update: { roleIds },
  });
}

/** A button click or dropdown pick on a role panel. */
export const panelComponent = defineComponent<AutorolesConfig>({
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild() || interaction.isModalSubmit()) return;
    const [, panelId, roleId] = interaction.customId.split(':');

    const row = panelId ? await ctx.db.rolePanel.findUnique({ where: { id: panelId } }) : null;
    if (!row || row.guildId !== interaction.guildId) {
      await interaction.reply({ content: ctx.t('autoroles.panelMissing'), flags: MessageFlags.Ephemeral });
      return;
    }

    const panel = toPanel(row);
    const member = interaction.member;
    const isSelect = interaction.isStringSelectMenu();
    const picked = isSelect ? interaction.values : roleId ? [roleId] : [];
    const changes = computeRoleChanges(panel, new Set(member.roles.cache.keys()), picked, isSelect ? 'select' : 'button');

    if (changes.limited) {
      await interaction.reply({ content: ctx.t('autoroles.limit', { max: panel.maxRoles ?? 0 }), flags: MessageFlags.Ephemeral });
      return;
    }

    const add = assignable(member, changes.add);
    const remove = assignable(member, changes.remove);
    const skipped = changes.add.length + changes.remove.length - add.length - remove.length;
    await changeMemberRoles(member, { add, remove }, `${REASON}: role panel`);

    const lines = [
      add.length > 0 ? ctx.t('autoroles.added', { roles: add.map(roleMention).join(', ') }) : null,
      remove.length > 0 ? ctx.t('autoroles.removed', { roles: remove.map(roleMention).join(', ') }) : null,
      skipped > 0 ? ctx.t('autoroles.cannotManage') : null,
    ].filter(Boolean);
    await interaction.reply({
      content: lines.length > 0 ? lines.join('\n') : ctx.t('autoroles.unchanged'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
});

/** A button click or dropdown pick on an info panel: the member alone sees the item's reply. */
export const infoPanelComponent = defineComponent<AutorolesConfig>({
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild() || interaction.isModalSubmit()) return;
    const [, panelId, buttonItemId] = interaction.customId.split(':');

    const row = panelId ? await ctx.db.infoPanel.findUnique({ where: { id: panelId } }) : null;
    if (!row || row.guildId !== interaction.guildId) {
      await interaction.reply({ content: ctx.t('autoroles.infoPanelMissing'), flags: MessageFlags.Ephemeral });
      return;
    }

    const isSelect = interaction.isStringSelectMenu();
    const itemId = isSelect ? interaction.values[0] : buttonItemId;
    const item = toInfoPanel(row).items.find((i) => i.id === itemId);
    if (!item) {
      await interaction.reply({ content: ctx.t('autoroles.infoItemMissing'), flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = { id: interaction.channelId, name: interaction.channel?.name ?? '' };
    const reply = { ...renderMessage(item.reply, { ...memberTemplateVars(interaction.member), ...channelVars(channel) }), flags: MessageFlags.Ephemeral } as const;
    if (!isSelect) {
      await interaction.reply(reply);
      return;
    }
    // Discord keeps the picked option selected, and picking it again would send nothing: the menu is reset
    // to the posted one, and the reply follows.
    await interaction.update({ components: interaction.message.components });
    await interaction.followUp(reply);
  },
});
