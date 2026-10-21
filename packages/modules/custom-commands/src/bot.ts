import type { BotModuleContext, FallbackCommand } from '@bot/core';
import type { CustomCommand } from '@bot/db';
import { changeMemberRoles, memberTemplateVars } from '@bot/discord';
import { channelVars, renderMessage } from '@bot/templates';
import { MessageFlags, type GuildMember, type Message } from 'discord.js';
import { LRUCache } from 'lru-cache';
import { toDto, type CommandDto, type CustomCommandsConfig } from './config.js';
import { ARGS_OPTION } from './discord-sync.js';
import { matchTrigger } from './matching.js';

type Ctx = BotModuleContext<CustomCommandsConfig>;

/** A guild's triggers are needed for every message. API changes become visible within ≤ 30 s. */
const triggerCache = new LRUCache<string, CommandDto[]>({ max: 10_000, ttl: 30_000 });

/** Drops the cached triggers after a change from Discord (other clusters catch up within 30 s). */
export function forgetTriggers(guildId: string): void {
  triggerCache.delete(guildId);
}

async function guildTriggers(ctx: Ctx, guildId: string): Promise<CommandDto[]> {
  let triggers = triggerCache.get(guildId);
  if (!triggers) {
    const rows = await ctx.db.customCommand.findMany({ where: { guildId, kind: 'trigger', enabled: true }, orderBy: { createdAt: 'asc' } });
    triggers = rows.map(toDto);
    triggerCache.set(guildId, triggers);
  }
  return triggers;
}

/** The channel and roles are allowed (an empty list means no restriction). */
export function isAllowed(command: Pick<CommandDto, 'allowedChannelIds' | 'allowedRoleIds'>, channelId: string, roleIds: readonly string[]): boolean {
  if (command.allowedChannelIds.length > 0 && !command.allowedChannelIds.includes(channelId)) return false;
  if (command.allowedRoleIds.length > 0 && !command.allowedRoleIds.some((id) => roleIds.includes(id))) return false;
  return true;
}

/** Per-user cooldown in Redis — shared by clusters. `true` — may run. */
async function takeCooldown(ctx: Ctx, command: CommandDto, userId: string): Promise<boolean> {
  if (command.cooldownSec === 0) return true;
  return (await ctx.redis.set(`custom-commands:cd:${command.id}:${userId}`, '1', 'EX', command.cooldownSec, 'NX')) === 'OK';
}

async function applyActions(ctx: Ctx, command: CommandDto, member: GuildMember): Promise<void> {
  const editable = (id: string) => member.guild.roles.cache.get(id)?.editable ?? false;
  const add = command.actions.addRoleIds.filter(editable);
  const remove = command.actions.removeRoleIds.filter(editable);
  try {
    await changeMemberRoles(member, { add, remove }, `Custom command: ${command.name}`);
  } catch (err) {
    ctx.logger.warn({ err, commandId: command.id }, 'Custom command role actions failed');
  }
}

function render(command: CommandDto, member: GuildMember, channel: { id: string; name: string }, args: string) {
  return renderMessage(command.response, { ...memberTemplateVars(member), ...channelVars(channel), args });
}

const countUse = (ctx: Ctx, command: CommandDto) =>
  ctx.db.customCommand.update({ where: { id: command.id }, data: { uses: { increment: 1 } } }).catch(() => undefined);

/** The guild's slash commands that are not in the module registry. */
export const customSlashCommand: FallbackCommand<CustomCommandsConfig> = {
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const row: CustomCommand | null = await ctx.db.customCommand.findUnique({
      where: { guildId_name: { guildId: interaction.guildId, name: interaction.commandName } },
    });
    if (!row || row.kind !== 'slash' || !row.enabled) {
      await interaction.reply({ content: ctx.t('custom-commands.unavailable'), flags: MessageFlags.Ephemeral });
      return;
    }

    const command = toDto(row);
    const member = interaction.member;
    if (!isAllowed(command, interaction.channelId, [...member.roles.cache.keys()])) {
      await interaction.reply({ content: ctx.t('custom-commands.notAllowed'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!(await takeCooldown(ctx, command, interaction.user.id))) {
      await interaction.reply({ content: ctx.t('custom-commands.cooldown'), flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = { id: interaction.channelId, name: interaction.channel?.name ?? '' };
    const message = render(command, member, channel, interaction.options.getString(ARGS_OPTION) ?? '');
    await interaction.reply({ ...message, ...(command.ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
    await applyActions(ctx, command, member);
    await countUse(ctx, command);
  },
};

/** Auto-replies: the guild's first matching trigger. */
export async function onMessage(ctx: Ctx, message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || !message.member || !message.content) return;
  const config = await ctx.getConfig(message.guildId);
  if (!config.triggersEnabled) return;

  const roleIds = [...message.member.roles.cache.keys()];
  for (const command of await guildTriggers(ctx, message.guildId)) {
    const match = matchTrigger(command, message.content);
    if (!match || !isAllowed(command, message.channelId, roleIds)) continue;
    if (!(await takeCooldown(ctx, command, message.author.id))) return;

    const channel = { id: message.channelId, name: 'name' in message.channel ? message.channel.name : '' };
    await message.channel.send(render(command, message.member, channel, match.args));
    await applyActions(ctx, command, message.member);
    if (command.actions.deleteTrigger) await message.delete().catch(() => undefined);
    await countUse(ctx, command);
    return;
  }
}
