import type { CoreServices } from '@bot/core';
import type { InviteCounts, InvitesConfig } from './config.js';

type Services = Pick<CoreServices, 'db' | 'redis'>;

/** The invite uses the bot last saw: `code → uses`. */
export const usesKey = (guildId: string) => `invites:uses:${guildId}`;

/** The invite whose uses grew since the last snapshot; `null` when none did (or several, which cannot be told apart). */
export function usedInvite(before: Readonly<Record<string, number>>, after: readonly { code: string; uses: number; inviterId: string | null }[]): { code: string; inviterId: string | null } | null {
  const grown = after.filter((invite) => invite.uses > (before[invite.code] ?? 0));
  return grown.length === 1 ? { code: grown[0]!.code, inviterId: grown[0]!.inviterId } : null;
}

export async function saveUses(services: Pick<Services, 'redis'>, guildId: string, invites: readonly { code: string; uses: number }[]): Promise<void> {
  const key = usesKey(guildId);
  const multi = services.redis.multi().del(key);
  if (invites.length > 0) multi.hset(key, Object.fromEntries(invites.map((i) => [i.code, String(i.uses)])));
  await multi.exec();
}

export async function readUses(services: Pick<Services, 'redis'>, guildId: string): Promise<Record<string, number>> {
  const raw = await services.redis.hgetall(usesKey(guildId));
  return Object.fromEntries(Object.entries(raw).map(([code, uses]) => [code, Number(uses)]));
}

export async function countsOf(services: Services, guildId: string, userId: string, config: Pick<InvitesConfig, 'countLeaves'>): Promise<InviteCounts> {
  const { db } = services;
  const [joins, left, fake] = await Promise.all([
    db.memberInvite.count({ where: { guildId, inviterId: userId } }),
    db.memberInvite.count({ where: { guildId, inviterId: userId, leftAt: { not: null }, fake: false } }),
    db.memberInvite.count({ where: { guildId, inviterId: userId, fake: true } }),
  ]);
  return { userId, joins, left, fake, total: Math.max(0, joins - fake - (config.countLeaves ? left : 0)) };
}

/**
 * Inviters by their counted invites, most first. The database counts (a row per inviter, not one per member who ever
 * joined): a server of a hundred thousand joins is a few hundred inviters here.
 */
export async function leaderboard(services: Services, guildId: string, config: Pick<InvitesConfig, 'countLeaves'>, limit = 25, offset = 0): Promise<InviteCounts[]> {
  const { db } = services;
  const byInviter = (where: { fake?: boolean; leftAt?: { not: null } }) =>
    db.memberInvite.groupBy({ by: ['inviterId'], where: { guildId, inviterId: { not: null }, ...where }, _count: { _all: true } });
  const [joins, fake, left] = await Promise.all([byInviter({}), byInviter({ fake: true }), byInviter({ fake: false, leftAt: { not: null } })]);
  const counts = new Map<string, InviteCounts>(joins.map((row) => [row.inviterId!, { userId: row.inviterId!, joins: row._count._all, left: 0, fake: 0, total: 0 }]));
  for (const row of fake) counts.get(row.inviterId!)!.fake = row._count._all;
  for (const row of left) counts.get(row.inviterId!)!.left = row._count._all;
  for (const c of counts.values()) c.total = Math.max(0, c.joins - c.fake - (config.countLeaves ? c.left : 0));
  return [...counts.values()].sort((a, b) => b.total - a.total || b.joins - a.joins).slice(offset, offset + limit);
}

/** Reward roles the inviter has earned: every reward up to their count. */
export const earnedRoles = (rewards: InvitesConfig['rewards'], total: number) => rewards.filter((r) => r.invites <= total).map((r) => r.roleId);
