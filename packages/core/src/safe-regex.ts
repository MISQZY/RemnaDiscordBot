import { LRUCache } from 'lru-cache';
import { RE2JS } from 're2js';

// Regexes written by server admins run against every message of their guild in the shared
// cluster process. V8's backtracking engine lets one pattern like `((a)+)+$` freeze the event
// loop for all guilds of the cluster, so such regexes go through RE2: linear time, but no
// lookarounds and no backreferences.

/** Longest text a regex is run against: a whole message, Nitro ones included. */
export const SAFE_REGEX_MAX_INPUT = 4000;

/** The regex's problem, or `null` when it can be saved. */
export function safeRegexProblem(pattern: string): string | null {
  try {
    RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
    return null;
  } catch {
    return 'Invalid regular expression (lookarounds and backreferences are not supported)';
  }
}

const compiled = new LRUCache<string, RE2JS | false>({ max: 5000 });

/** Case-insensitive, compiled once per source; `null` for a pattern RE2 cannot compile. */
export function safeRegex(pattern: string): RE2JS | null {
  let regex = compiled.get(pattern);
  if (regex === undefined) {
    try {
      regex = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
    } catch {
      regex = false;
    }
    compiled.set(pattern, regex);
  }
  return regex || null;
}

/** The first match in the text (cut to {@link SAFE_REGEX_MAX_INPUT}) and its groups, or `null`. */
export function safeMatch(regex: RE2JS, text: string): { match: string; groups: string[] } | null {
  const matcher = regex.matcher(text.slice(0, SAFE_REGEX_MAX_INPUT));
  if (!matcher.find()) return null;
  const groups: string[] = [];
  for (let i = 1; i <= matcher.groupCount(); i++) groups.push(matcher.group(i) ?? '');
  return { match: matcher.group(0) ?? '', groups };
}
