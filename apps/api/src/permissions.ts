import { PermissionFlagsBits } from 'discord-api-types/v10';

/** Права, которые бот запрашивает при приглашении — по потребностям модулей MVP. */
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

/** Настраивать бота может владелец, Administrator или Manage Server. */
export function canManageGuild({ owner, permissions }: { owner: boolean; permissions: string }): boolean {
  if (owner) return true;
  const granted = BigInt(permissions);
  return (granted & (PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild)) !== 0n;
}
