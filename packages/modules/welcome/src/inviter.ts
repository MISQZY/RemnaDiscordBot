import type { ModuleServices } from '@bot/core';
import type {} from '@bot/module-invites';
import type { TemplateVars } from '@bot/templates';
import type { WelcomeConfig } from './config.js';

type Joined = { guildId: string; userId: string; inviterId: string | null; code: string | null; invites: number };

// The invites module finds the inviter on the same join, at the same time as welcome greets: whichever comes first
// waits for the other here, in this process (both handle the gateway event of this cluster).

const WAIT_MS = 5_000;
const arrivals = new Map<string, Joined>();
const waiters = new Map<string, (joined: Joined | null) => void>();
const keyOf = (guildId: string, userId: string) => `${guildId}:${userId}`;

export function onInviteJoined(joined: Joined): void {
  const key = keyOf(joined.guildId, joined.userId);
  const waiter = waiters.get(key);
  if (waiter) {
    waiters.delete(key);
    waiter(joined);
    return;
  }
  arrivals.set(key, joined);
  setTimeout(() => arrivals.delete(key), 30_000).unref();
}

/** The join or DM greeting mentions the inviter. */
export const usesInviter = (config: WelcomeConfig) => /\{invite(r|\.)/.test(JSON.stringify([config.join.message, config.joinDm.message]));

/** `{inviter}`, `{inviter.id}`, `{inviter.invites}`, `{invite.code}` — empty when the invites module is off or did not tell. */
export async function inviterVars(ctx: Pick<ModuleServices<WelcomeConfig>, 'config'>, guildId: string, userId: string, config: WelcomeConfig): Promise<TemplateVars> {
  if (!usesInviter(config) || !(await ctx.config.isEnabled(guildId, 'invites'))) return {};
  const key = keyOf(guildId, userId);
  let joined = arrivals.get(key) ?? null;
  arrivals.delete(key);
  joined ??= await new Promise<Joined | null>((resolve) => {
    waiters.set(key, resolve);
    setTimeout(() => {
      if (waiters.get(key) === resolve) waiters.delete(key);
      resolve(null);
    }, WAIT_MS).unref();
  });
  const unknown = '—';
  return {
    inviter: joined?.inviterId ? `<@${joined.inviterId}>` : unknown,
    'inviter.id': joined?.inviterId ?? unknown,
    'inviter.invites': joined?.inviterId ? joined.invites : 0,
    'invite.code': joined?.code ?? unknown,
  };
}
