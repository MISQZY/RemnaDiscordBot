import type { GuildMember } from 'discord.js';

export type PunishAction = 'ban' | 'kick' | 'mute' | 'warn';

/**
 * Whether the moderator may punish the member. Returns an i18n error key or `null`.
 * Not allowed: yourself, the owner, the bot, a member whose role is not lower than yours; or what the bot itself cannot do.
 */
export function hierarchyError(moderator: GuildMember, target: GuildMember, action: PunishAction): string | null {
  const guild = target.guild;
  if (target.id === moderator.id) return 'moderation.errors.self';
  if (target.id === guild.ownerId) return 'moderation.errors.owner';
  if (target.id === guild.client.user.id) return 'moderation.errors.bot';
  if (moderator.id !== guild.ownerId && target.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) {
    return 'moderation.errors.hierarchy';
  }
  const botCan = action === 'ban' ? target.bannable : action === 'kick' ? target.kickable : action === 'mute' ? target.moderatable : true;
  return botCan ? null : 'moderation.errors.botHierarchy';
}
