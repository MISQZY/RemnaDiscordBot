import { safeMatch, safeRegex, safeRegexProblem } from '@bot/core';

/** Length of the text searched for triggers. */
const MAX_INPUT = 2000;

/** The regex's problem, or `null` when it can be saved. */
export const regexProblem = safeRegexProblem;

export interface TriggerLike {
  id: string;
  matchMode: string | null;
  pattern: string | null;
}

/** Whether the trigger matched; `args` is the text after the match (`startsWith`) or the first group (`regex`). */
export function matchTrigger(trigger: TriggerLike, content: string): { args: string } | null {
  const pattern = trigger.pattern;
  if (!pattern) return null;
  const text = content.slice(0, MAX_INPUT);
  const lower = text.trim().toLowerCase();
  const needle = pattern.toLowerCase();

  switch (trigger.matchMode) {
    case 'exact':
      return lower === needle ? { args: '' } : null;
    case 'startsWith': {
      if (!lower.startsWith(needle)) return null;
      const rest = text.trim().slice(pattern.length);
      return rest === '' || /^\s/.test(rest) ? { args: rest.trim() } : null;
    }
    case 'contains':
      return lower.includes(needle) ? { args: '' } : null;
    case 'regex': {
      const regex = safeRegex(pattern);
      const match = regex && safeMatch(regex, text);
      return match ? { args: match.groups[0] ?? '' } : null;
    }
    default:
      return null;
  }
}
