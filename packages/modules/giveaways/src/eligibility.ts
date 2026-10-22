import type { GuildMember } from 'discord.js';

/** Why the member cannot enter: a required role missing, too new on the server; `null` — they can. */
export function entryProblem(
  member: Pick<GuildMember, 'joinedTimestamp'> & { roles: { cache: { has(id: string): boolean } } },
  requirements: { requiredRoleIds: readonly string[]; minMemberDays: number },
  now = Date.now(),
): { key: string; vars?: Record<string, string | number> } | null {
  const missing = requirements.requiredRoleIds.filter((id) => !member.roles.cache.has(id));
  if (missing.length > 0) return { key: 'giveaways.needRoles', vars: { roles: missing.map((id) => `<@&${id}>`).join(', ') } };
  const days = member.joinedTimestamp ? (now - member.joinedTimestamp) / 86_400_000 : 0;
  if (days < requirements.minMemberDays) return { key: 'giveaways.tooNew', vars: { days: requirements.minMemberDays } };
  return null;
}
