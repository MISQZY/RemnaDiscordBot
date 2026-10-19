/** Length of the text searched for triggers — bounds the cost of regexes. */
const MAX_INPUT = 2000;

/** Nested quantifiers like `(a+)+`, `(\w*)*` — a classic source of catastrophic backtracking. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

/** The regex's problem, or `null` when it can be saved. */
export function regexProblem(pattern: string): string | null {
  try {
    new RegExp(pattern, 'iu');
  } catch {
    return 'Invalid regular expression';
  }
  if (NESTED_QUANTIFIER.test(pattern)) return 'Nested quantifiers like (a+)+ are not allowed';
  return null;
}

export interface TriggerLike {
  id: string;
  matchMode: string | null;
  pattern: string | null;
}

const compiled = new Map<string, RegExp>();

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
      const key = `${trigger.id}:${pattern}`;
      let regex = compiled.get(key);
      if (!regex) {
        regex = new RegExp(pattern, 'iu');
        compiled.set(key, regex);
      }
      const match = regex.exec(text);
      return match ? { args: match[1] ?? '' } : null;
    }
    default:
      return null;
  }
}
