import type { BotModuleContext, FallbackCommand } from '@bot/core';
import type { CustomCommand } from '@bot/db';
import { memberTemplateVars } from '@bot/discord';
import { channelVars, renderMessage } from '@bot/templates';
import { MessageFlags, type GuildMember, type Message } from 'discord.js';
import { LRUCache } from 'lru-cache';
import { toDto, type CommandDto, type CustomCommandsConfig } from './config.js';
import { ARGS_OPTION } from './discord-sync.js';
import { matchTrigger } from './matching.js';

type Ctx = BotModuleContext<CustomCommandsConfig>;

/** Триггеры гильдии нужны на каждое сообщение. Изменения из API видны через ≤ 30 с. */
const triggerCache = new LRUCache<string, CommandDto[]>({ max: 10_000, ttl: 30_000 });

async function guildTriggers(ctx: Ctx, guildId: string): Promise<CommandDto[]> {
  let triggers = triggerCache.get(guildId);
  if (!triggers) {
    const rows = await ctx.db.customCommand.findMany({ where: { guildId, kind: 'trigger', enabled: true }, orderBy: { createdAt: 'asc' } });
    triggers = rows.map(toDto);
    triggerCache.set(guildId, triggers);
  }
  return triggers;
}

/** Канал и роли разрешены (пустой список — без ограничений). */
export function isAllowed(command: Pick<CommandDto, 'allowedChannelIds' | 'allowedRoleIds'>, channelId: string, roleIds: readonly string[]): boolean {
  if (command.allowedChannelIds.length > 0 && !command.allowedChannelIds.includes(channelId)) return false;
  if (command.allowedRoleIds.length > 0 && !command.allowedRoleIds.some((id) => roleIds.includes(id))) return false;
  return true;
}

/** Кулдаун на пользователя в Redis — общий для кластеров. `true` — можно выполнять. */
async function takeCooldown(ctx: Ctx, command: CommandDto, userId: string): Promise<boolean> {
  if (command.cooldownSec === 0) return true;
  return (await ctx.redis.set(`custom-commands:cd:${command.id}:${userId}`, '1', 'EX', command.cooldownSec, 'NX')) === 'OK';
}

async function applyActions(ctx: Ctx, command: CommandDto, member: GuildMember): Promise<void> {
  const editable = (id: string) => member.guild.roles.cache.get(id)?.editable ?? false;
  const add = command.actions.addRoleIds.filter(editable);
  const remove = command.actions.removeRoleIds.filter(editable);
  try {
    if (add.length > 0) await member.roles.add(add, `Custom command: ${command.name}`);
    if (remove.length > 0) await member.roles.remove(remove, `Custom command: ${command.name}`);
  } catch (err) {
    ctx.logger.warn({ err, commandId: command.id }, 'Custom command role actions failed');
  }
}

function render(command: CommandDto, member: GuildMember, channel: { id: string; name: string }, args: string) {
  return renderMessage(command.response, { ...memberTemplateVars(member), ...channelVars(channel), args });
}

const countUse = (ctx: Ctx, command: CommandDto) =>
  ctx.db.customCommand.update({ where: { id: command.id }, data: { uses: { increment: 1 } } }).catch(() => undefined);

/** Slash-команды гильдии, которых нет в реестре модулей. */
export const customSlashCommand: FallbackCommand<CustomCommandsConfig> = {
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const row: CustomCommand | null = await ctx.db.customCommand.findUnique({
      where: { guildId_name: { guildId: interaction.guildId, name: interaction.commandName } },
    });
    if (!row || row.kind !== 'slash' || !row.enabled) {
      await interaction.reply({ content: ctx.t('customCommands.unavailable'), flags: MessageFlags.Ephemeral });
      return;
    }

    const command = toDto(row);
    const member = interaction.member;
    if (!isAllowed(command, interaction.channelId, [...member.roles.cache.keys()])) {
      await interaction.reply({ content: ctx.t('customCommands.notAllowed'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!(await takeCooldown(ctx, command, interaction.user.id))) {
      await interaction.reply({ content: ctx.t('customCommands.cooldown'), flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = { id: interaction.channelId, name: interaction.channel?.name ?? '' };
    const message = render(command, member, channel, interaction.options.getString(ARGS_OPTION) ?? '');
    await interaction.reply({ ...message, ...(command.ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
    await applyActions(ctx, command, member);
    await countUse(ctx, command);
  },
};

/** Автоответы: первый подходящий триггер гильдии. */
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
