import { PermissionFlagsBits } from 'discord-api-types/v10';

/** Permissions the bot requests on invite — based on what the MVP modules need. */
export const BOT_INVITE_PERMISSIONS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.UseExternalEmojis |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ViewAuditLog;

/** The owner, Administrator or Manage Server can configure the bot. */
export function canManageGuild({ owner, permissions }: { owner: boolean; permissions: string }): boolean {
  if (owner) return true;
  const granted = BigInt(permissions);
  return (granted & (PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild)) !== 0n;
}
