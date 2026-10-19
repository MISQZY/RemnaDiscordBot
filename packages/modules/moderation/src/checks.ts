import type { GuildMember } from 'discord.js';

export type PunishAction = 'ban' | 'kick' | 'mute' | 'warn';

/**
 * Можно ли модератору наказать участника. Возвращает ключ ошибки i18n или `null`.
 * Нельзя: себя, владельца, бота, участника с ролью не ниже своей; и то, что не может сам бот.
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
