import type { GuildMember } from 'discord.js';

/**
 * Adds and removes roles one by one via the per-role endpoints. discord.js sends an array as a PATCH
 * of the member's whole role list built from its cache — a stale cache would wipe roles the change never touched.
 */
export async function changeMemberRoles(
  member: GuildMember,
  changes: { add?: readonly string[]; remove?: readonly string[] },
  reason?: string,
): Promise<void> {
  for (const id of changes.add ?? []) await member.roles.add(id, reason);
  for (const id of changes.remove ?? []) await member.roles.remove(id, reason);
}
