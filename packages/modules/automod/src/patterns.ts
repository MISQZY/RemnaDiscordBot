import { safeRegexProblem } from '@bot/core';

/** The regex's problem, or `null` when it can be saved (the same rule as custom command triggers). */
export const regexProblem = safeRegexProblem;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One RE2 pattern for a list of banned words: whole words only, `*` — any letters.
 * RE2 has no lookarounds, so a word is bounded by a non-letter or the edge of the text
 * and comes out as the first group. `null` for an empty list.
 */
export function wordsPattern(words: readonly string[]): string | null {
  const parts = words
    .map((w) => w.trim().replace(/\*{2,}/g, '*'))
    .filter(Boolean)
    .map((w) => escape(w).replace(/\\\*/g, '[\\p{L}\\p{N}]*'));
  if (parts.length === 0) return null;
  return `(?:^|[^\\p{L}\\p{N}])(${parts.join('|')})(?:$|[^\\p{L}\\p{N}])`;
}
