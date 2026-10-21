import type { ModCase } from '@bot/db';
import { isActive } from './config.js';

/** A member's cases as lines of a private reply: number, action, reason and when; active ones marked. */
export function historyLines(ctx: { t(key: string, vars?: Record<string, string | number>): string }, username: string, cases: readonly ModCase[]): string {
  if (cases.length === 0) return ctx.t('moderation.history.empty', { user: username });
  const lines = cases.map((c) => {
    const when = `<t:${Math.floor(c.createdAt.getTime() / 1000)}:R>`;
    const mark = isActive(c) ? ' · ⏳' : '';
    return `**#${c.number}** ${ctx.t(`moderation.actions.${c.type}`)}${mark} · ${c.reason ?? ctx.t('moderation.case.noReason')} · ${when}`;
  });
  return [ctx.t('moderation.history.title', { user: username, count: cases.length }), ...lines].join('\n').slice(0, 2000);
}
