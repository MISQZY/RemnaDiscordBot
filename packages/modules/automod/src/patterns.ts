/** Nested quantifiers like `(a+)+`, `(\w*)*` — a classic source of catastrophic backtracking. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

/** The regex's problem, or `null` when it can be saved (the same rule as custom command triggers). */
export function regexProblem(pattern: string): string | null {
  try {
    new RegExp(pattern, 'iu');
  } catch {
    return 'Invalid regular expression';
  }
  if (NESTED_QUANTIFIER.test(pattern)) return 'Nested quantifiers like (a+)+ are not allowed';
  return null;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One regex for a list of banned words: whole words only, case-insensitive, `*` — any letters.
 * `null` for an empty list.
 */
export function wordsRegex(words: readonly string[]): RegExp | null {
  const parts = words
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => escape(w).replace(/\\\*/g, '[\\p{L}\\p{N}]*'));
  if (parts.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

const cache = new Map<string, RegExp | null>();

/** Compiled regexes are kept by their source: configs change rarely, messages come often. */
export function cached(key: string, build: () => RegExp | null): RegExp | null {
  if (!cache.has(key)) {
    if (cache.size > 2000) cache.clear();
    cache.set(key, build());
  }
  return cache.get(key)!;
}
