// Formats of a placeholder's value: `{price:number}`, `{change:fixed1:signed}`, `{day:dd.mm.yyyy}`. A placeholder may name
// a few, joined by `:`; at most one says how the number looks, `signed` and `abs` go with any; a date format (date.ts)
// stands alone. A value that is not a number (or a date) is left as it is, and a format the bot does not know leaves the
// whole placeholder as written, so the mistake shows.

import { formatDate, isDateFormat } from './date.js';

/** How the number looks: grouped with up to two decimals, a whole number, exactly N decimals, or short (1.6M). */
const STYLES = ['number', 'round', 'fixed0', 'fixed1', 'fixed2', 'fixed3', 'compact'] as const;
type Style = (typeof STYLES)[number];

/** Every format a placeholder may name. */
export const PLACEHOLDER_FORMATS = [...STYLES, 'signed', 'abs'] as const;
export type PlaceholderFormat = (typeof PLACEHOLDER_FORMATS)[number];

const isFormat = (name: string): name is PlaceholderFormat => (PLACEHOLDER_FORMATS as readonly string[]).includes(name);

/** A number given as text the way APIs and feeds give it: `538270`, `-16.14`, `1e6`. */
const NUMERIC = /^\s*-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i;

function toNumber(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!NUMERIC.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function options(style: Style): Intl.NumberFormatOptions {
  switch (style) {
    case 'number':
      return { maximumFractionDigits: 2 };
    case 'round':
      return { maximumFractionDigits: 0 };
    case 'compact':
      return { notation: 'compact', maximumFractionDigits: 1 };
    default: {
      const digits = Number(style.slice('fixed'.length));
      return { minimumFractionDigits: digits, maximumFractionDigits: digits };
    }
  }
}

/**
 * The value with the formats applied, in the locale's way of writing numbers and dates (`ru`: 538 270,5; `en`: 538,270.5).
 * `null` — a format is unknown, two say how the number looks, or a date format has company: the placeholder stays as
 * written. `now` — for relative dates.
 */
export function formatValue(value: string | number, formats: readonly string[], locale = 'en', now = Date.now()): string | null {
  // A date takes one format and nothing more (see date.ts).
  if (formats.some(isDateFormat)) return formats.length === 1 ? formatDate(value, formats[0]!, locale, now) : null;
  if (!formats.every(isFormat)) return null;
  const styles = formats.filter((f): f is Style => (STYLES as readonly string[]).includes(f));
  if (styles.length > 1) return null;
  const n = toNumber(value);
  if (n === null) return String(value);

  const abs = formats.includes('abs');
  const intl: Intl.NumberFormatOptions = { ...options(styles[0] ?? 'number'), ...(formats.includes('signed') && !abs ? { signDisplay: 'exceptZero' } : {}) };
  try {
    return new Intl.NumberFormat(locale, intl).format(abs ? Math.abs(n) : n);
  } catch {
    // A locale Intl does not know: the same in English.
    return new Intl.NumberFormat('en', intl).format(abs ? Math.abs(n) : n);
  }
}
