import type { BotModuleContext, FallbackCommand } from '@bot/core';
import type { CustomCommand } from '@bot/db';
import { assignableRoleIds, changeMemberRoles, memberTemplateVars } from '@bot/discord';
import { channelVars, renderMessage } from '@bot/templates';
import { channelMention, MessageFlags, roleMention, userMention, type ChatInputCommandInteraction, type Guild, type GuildMember, type Message } from 'discord.js';
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
  const add = assignableRoleIds(member.guild, command.actions.addRoleIds);
  const remove = assignableRoleIds(member.guild, command.actions.removeRoleIds);
  try {
    await changeMemberRoles(member, { add, remove }, `Custom command: ${command.name}`);
  } catch (err) {
    ctx.logger.warn({ err, commandId: command.id }, 'Custom command role actions failed');
  }
}

function render(command: CommandDto, member: GuildMember, channel: { id: string; name: string }, args: string, options: Record<string, string> = {}) {
  return renderMessage(command.response, { ...memberTemplateVars(member), ...channelVars(channel), args, ...options });
}

/** The values of the command's options as the reply shows them; an option left out is empty. */
export function optionVars(command: Pick<CommandDto, 'options'>, interaction: ChatInputCommandInteraction, ctx: { tGuild(key: string): string }): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const option of command.options) {
    const value = interaction.options.get(option.name)?.value;
    if (value === undefined || value === null) vars[option.name] = '';
    else if (option.type === 'user') vars[option.name] = userMention(String(value));
    else if (option.type === 'channel') vars[option.name] = channelMention(String(value));
    else if (option.type === 'role') vars[option.name] = roleMention(String(value));
    else if (option.type === 'boolean') vars[option.name] = ctx.tGuild(value ? 'custom-commands.yes' : 'custom-commands.no');
    else vars[option.name] = String(value);
  }
  return vars;
}

/** The channel the reply goes to instead of the one the command was used in; `null` — it is gone or not a text one. */
function responseChannel(guild: Guild, command: Pick<CommandDto, 'responseChannelId'>) {
  const channel = command.responseChannelId ? guild.channels.cache.get(command.responseChannelId) : undefined;
  return channel?.isTextBased() && channel.isSendable() ? channel : null;
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
    const args = command.options.length ? '' : (interaction.options.getString(ARGS_OPTION) ?? '');
    const message = render(command, member, channel, args, optionVars(command, interaction, ctx));
    if (command.responseChannelId && command.responseChannelId !== interaction.channelId) {
      // The reply goes to its channel; whoever used the command learns where (or that it could not be sent).
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const target = responseChannel(interaction.guild, command);
      try {
        if (!target) throw new Error('Response channel is gone');
        await target.send(message);
      } catch (err) {
        ctx.logger.warn({ err, commandId: command.id, channelId: command.responseChannelId }, 'Custom command reply not sent');
        await interaction.editReply({ content: ctx.t('custom-commands.sendFailed') });
        return;
      }
      await interaction.editReply({ content: ctx.t('custom-commands.sentTo', { channel: channelMention(target.id) }) });
    } else {
      await interaction.reply({ ...message, ...(command.ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
    }
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
    const target = command.responseChannelId ? responseChannel(message.guild, command) : message.channel;
    try {
      await target?.send(render(command, message.member, channel, match.args));
    } catch (err) {
      ctx.logger.warn({ err, commandId: command.id, channelId: command.responseChannelId }, 'Custom command reply not sent');
    }
    await applyActions(ctx, command, message.member);
    if (command.actions.deleteTrigger) await message.delete().catch(() => undefined);
    await countUse(ctx, command);
    return;
  }
}
