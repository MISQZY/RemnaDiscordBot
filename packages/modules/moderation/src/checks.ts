import { Snowflake } from '@bot/contracts';
import type { PrismaClient } from '@bot/db';
import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import { z } from 'zod';

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

interface CacheEntry {
  expiresAt: number;
  roles: string[];
}

const modRolesCache = new Map<string, CacheEntry>();

/** Drops the cached mod roles for a guild on config invalidation. */
export function invalidateModRolesCache(guildId: string): void {
  modRolesCache.delete(guildId);
}

/** Reads the server's configured moderator roles (Guild.modRoleIds). */
export async function getGuildModRoleIds(db?: PrismaClient | null, guildId?: string): Promise<string[]> {
  if (!db || !guildId) return [];
  const cached = modRolesCache.get(guildId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.roles;
  const row = await db.guild?.findUnique({ where: { id: guildId }, select: { modRoleIds: true } }).catch(() => null);
  const ids = z.array(Snowflake).safeParse(row?.modRoleIds).data ?? [];
  if (modRolesCache.size > 10_000) modRolesCache.clear();
  modRolesCache.set(guildId, { expiresAt: now + 60_000, roles: ids });
  return ids;
}

/**
 * Checks whether the member is allowed to perform a moderation action:
 * - Server owner or member with Administrator / ManageGuild
 * - Member with the specific Discord permission
 * - Member with one of the configured moderator roles (Guild.modRoleIds)
 */
export function isMemberModerator(
  member: GuildMember | null | undefined,
  modRoleIds: readonly string[],
  discordPermission?: bigint,
): boolean {
  if (!member) return false;
  if (member.guild && member.id === member.guild.ownerId) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }
  if (discordPermission && member.permissions?.has(discordPermission)) {
    return true;
  }
  if (modRoleIds.length > 0 && member.roles?.cache && modRoleIds.some((id) => member.roles.cache.has(id))) {
    return true;
  }
  return false;
}
