import type { CoreServices } from '@bot/core';
import { ModerationService, SYSTEM_MODERATOR, type ModerationConfig } from '@bot/module-moderation';
import type { GuildMember } from 'discord.js';

/** `softban` — banned to delete the member's messages and unbanned at once (a kick that wipes their spam). */
export type Punishment = 'none' | 'warn' | 'mute' | 'kick' | 'ban' | 'softban';

/**
 * Punishes through the moderation module, so the automatic punishment is a case like any other: logged, DMed,
 * counted toward escalation. Members the bot cannot touch (owner, higher roles) are left alone.
 */
export async function punish(
  services: Pick<CoreServices, 'db' | 'rest' | 'scheduler' | 'i18n' | 'logger' | 'bus' | 'config'>,
  member: GuildMember,
  punishment: Punishment,
  { reason, durationSec, deleteMessageSeconds }: { reason: string; durationSec?: number; deleteMessageSeconds?: number },
): Promise<boolean> {
  if (punishment === 'none') return false;
  const allowed =
    punishment === 'ban' || punishment === 'softban' ? member.bannable : punishment === 'kick' ? member.kickable : punishment === 'mute' ? member.moderatable : true;
  if (!allowed) return false;

  const config = (await services.config.get<ModerationConfig>(member.guild.id, 'moderation')).config;
  const service = new ModerationService(services);
  const input = { guildId: member.guild.id, targetId: member.id, moderatorId: SYSTEM_MODERATOR, reason, deleteMessageSeconds };
  try {
    if (punishment === 'warn') await service.warn(input, config);
    else if (punishment === 'mute') await service.mute({ ...input, durationSec: durationSec ?? 600 }, config);
    else if (punishment === 'kick') await service.kick(input, config);
    else if (punishment === 'softban') await service.softban(input, config);
    else await service.ban(input, config);
    return true;
  } catch (err) {
    services.logger.warn({ err, guildId: member.guild.id, userId: member.id, punishment }, 'Automod punishment failed');
    return false;
  }
}
