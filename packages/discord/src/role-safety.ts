import { PermissionFlagsBits, type GuildMember, type Role } from 'discord.js';

/**
 * Moderator permissions: the ones Discord requires 2FA for, plus pinging everyone. Panels, join roles,
 * level rewards, verification and custom commands hand roles out to anyone, so a role with any of these
 * would let whoever configures the bot (Manage Server or Manage Roles) grant themselves more than they have.
 */
export const ELEVATED_PERMISSIONS =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.ManageGuildExpressions |
  PermissionFlagsBits.ManageEvents |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.MentionEveryone;

export function isElevatedRole(role: Role): boolean {
  return (role.permissions.bitfield & ELEVATED_PERMISSIONS) !== 0n;
}

/** The bot may hand the role out: below its own role, not managed, not @everyone, no moderator permissions. */
export function canAssignRole(role: Role): boolean {
  return role.editable && !role.managed && role.id !== role.guild.id && !isElevatedRole(role);
}

/** Roles of a guild the bot may hand out, from the given ids. */
export function assignableRoleIds(guild: GuildMember['guild'], roleIds: readonly string[]): string[] {
  return roleIds.filter((id) => {
    const role = guild.roles.cache.get(id);
    return role !== undefined && canAssignRole(role);
  });
}

/** Whether the member may pick the role for the bot to hand out: owners always, others only below their top role. */
export function memberOutranksRole(member: GuildMember, role: Role): boolean {
  return member.id === member.guild.ownerId || member.roles.highest.comparePositionTo(role) > 0;
}
