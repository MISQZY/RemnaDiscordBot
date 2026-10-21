import type { BotModuleContext } from '@bot/core';
import { PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import { SYSTEM_MODERATOR, type ModerationConfig } from './config.js';
import { ModerationService } from './service.js';

type Ctx = BotModuleContext<ModerationConfig>;

/** Spam bots post in many channels at once: one punishment for the burst. */
const ONCE_SEC = 60;

/** Who the honeypot leaves alone: bots, webhooks, the owner and anyone who moderates messages. */
export function isSpared(member: { id: string; permissions: { has(permission: bigint): boolean }; guild: { ownerId: string } }, bot: boolean): boolean {
  return bot || member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageMessages);
}

/** Whether the bot can do the honeypot's action to the member (roles below its own). */
export function canPunish(member: Pick<GuildMember, 'bannable' | 'kickable' | 'moderatable'>, action: ModerationConfig['honeypot']['action']): boolean {
  return action === 'kick' ? member.kickable : action === 'mute' ? member.moderatable : member.bannable;
}

/** A message in the honeypot channel: its author is punished at once, the message deleted. */
export async function onHoneypotMessage(ctx: Ctx, message: Message): Promise<void> {
  if (!message.inGuild() || message.system || message.webhookId) return;
  const config = await ctx.getConfig(message.guildId);
  const { honeypot } = config;
  if (!honeypot.channelId || message.channelId !== honeypot.channelId) return;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isSpared(member, message.author.bot)) return;

  await message.delete().catch(() => undefined);
  if (!(await ctx.redis.set(`moderation:honeypot:${message.guildId}:${member.id}`, '1', 'EX', ONCE_SEC, 'NX'))) return;
  if (!canPunish(member, honeypot.action)) {
    ctx.logger.warn({ guildId: message.guildId, userId: member.id }, 'Honeypot: the bot cannot punish this member');
    return;
  }

  const locale = await ctx.guildLocales.get(message.guildId);
  const input = {
    guildId: message.guildId,
    targetId: member.id,
    moderatorId: SYSTEM_MODERATOR,
    reason: ctx.i18n.t(locale, 'moderation.honeypot.reason'),
    deleteMessageSeconds: honeypot.deleteHours * 3600,
  };
  const service = new ModerationService(ctx);
  try {
    if (honeypot.action === 'ban') await service.ban(input, config);
    else if (honeypot.action === 'softban') await service.softban(input, config);
    else if (honeypot.action === 'kick') await service.kick(input, config);
    else await service.mute({ ...input, durationSec: honeypot.muteSec }, config);
  } catch (err) {
    ctx.logger.warn({ err, guildId: message.guildId, userId: member.id }, 'Honeypot punishment failed');
  }
}
