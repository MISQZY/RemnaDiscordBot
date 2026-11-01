import { PermissionFlagsBits, type BaseInteraction } from 'discord.js';
import type { Repliable } from './reply.js';
import { ephemeralReply } from './reply.js';

/** Runtime permissions remain required even when Discord command integration overrides allow access. */
export function canManageGuild(interaction: Pick<BaseInteraction, 'guildId' | 'memberPermissions'>): boolean {
  return interaction.guildId !== null && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true;
}

/** Returns false after replying when the caller cannot change guild settings. */
export async function requireManageGuild(
  interaction: Pick<BaseInteraction, 'guildId' | 'memberPermissions'> & Repliable,
  ctx: { t: (key: string) => string },
): Promise<boolean> {
  if (canManageGuild(interaction)) return true;
  await ephemeralReply(interaction, ctx.t('core.manageGuildRequired'));
  return false;
}
