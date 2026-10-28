// Date formats of a placeholder's value: named ones (`{item.day:date}`, `datetime`, `time`, `relative`) or a mask
// (`{item.day:dd.mm.yyyy}`, `{published:d mmmm}`). Dates are shown in UTC: guilds have no time zone in the bot.

/** Formats by name, in the locale's way: 28 October 2026 · 28 October 2026 at 21:54 · 21:54 · yesterday. */
export const DATE_FORMATS = ['date', 'datetime', 'time', 'relative'] as const;

/**
 * A mask's parts: day `d` `dd`, month `m` `mm` `mmm` (Oct) `mmmm` (October), year `yy` `yyyy`, hours `hh`, minutes `mi`,
 * and `.` `/` `-` `_` or a space between them. No `:` — it joins formats already.
 */
const MASK_TOKEN = /yyyy|yy|mmmm|mmm|mm|mi|m|dd|d|hh|[./_ -]+/g;

/** Whether a format is a mask: only its parts, and at least one that is not a separator. */
export function isDateMask(format: string): boolean {
  const tokens = format.match(MASK_TOKEN);
  return tokens !== null && tokens.join('') === format && tokens.some((t) => /[a-z]/.test(t));
}

export const isDateFormat = (format: string): boolean => (DATE_FORMATS as readonly string[]).includes(format) || isDateMask(format);

/** `2026-10-28` alone: a day, not a moment — shown without a time, compared by days. */
const DAY_ONLY = /^\s*\d{4}-\d{2}-\d{2}\s*$/;

/**
 * A date the way sources give it: ISO (`2026-10-28`, `2026-10-28T21:54:39Z`), RFC 822 from feeds
 * (`Tue, 27 Oct 2026 10:00:00 GMT`) or Unix time in seconds or milliseconds. Anything else — null.
 */
export function parseDate(value: string | number): Date | null {
  if (typeof value === 'number' || /^\s*\d+(?:\.\d+)?\s*$/.test(value)) {
    const n = Number(value);
    // Seconds from 2001 to 2286, or milliseconds from 2001: a price or a count is not taken for a date.
    const ms = n >= 1e12 ? n : n >= 1e9 ? n * 1000 : NaN;
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  // A year is a must: Date.parse takes "1" or "May" too.
  if (!/\d{4}/.test(value)) return null;
  const ms = Date.parse(DAY_ONLY.test(value) ? `${value.trim()}T00:00:00Z` : value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** The locale if Intl knows it, else English. */
function known(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0 ? locale : 'en';
  } catch {
    return 'en';
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A month's name as Intl writes it: next to a day (October 28 → "октября") or alone ("октябрь"). */
function monthName(date: Date, locale: string, style: 'long' | 'short', withDay: boolean): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: style, ...(withDay ? { day: 'numeric' } : {}) }).formatToParts(date);
  return parts.find((p) => p.type === 'month')?.value ?? '';
}

function byMask(date: Date, mask: string, locale: string): string {
  const withDay = /d/.test(mask);
  return mask.replace(MASK_TOKEN, (token) => {
    switch (token) {
      case 'd':
        return String(date.getUTCDate());
      case 'dd':
        return pad(date.getUTCDate());
      case 'm':
        return String(date.getUTCMonth() + 1);
      case 'mm':
        return pad(date.getUTCMonth() + 1);
      case 'mmm':
        return monthName(date, locale, 'short', withDay);
      case 'mmmm':
        return monthName(date, locale, 'long', withDay);
      case 'yy':
        return pad(date.getUTCFullYear() % 100);
      case 'yyyy':
        return String(date.getUTCFullYear());
      case 'hh':
        return pad(date.getUTCHours());
      case 'mi':
        return pad(date.getUTCMinutes());
      default:
        return token;
    }
  });
}

const DAY_MS = 86_400_000;

/** "yesterday", "in 3 days", "5 minutes ago": by days for a day, else by the largest unit that fits. */
function relative(date: Date, dayOnly: boolean, locale: string, now: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (dayOnly) {
    const today = Math.floor(now / DAY_MS);
    return rtf.format(Math.floor(date.getTime() / DAY_MS) - today, 'day');
  }
  const seconds = Math.round((date.getTime() - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86_400],
    ['month', 30 * 86_400],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}

/** The value as a date in the format; what is not a date is left as it is. */
export function formatDate(value: string | number, format: string, locale: string, now = Date.now()): string {
  const date = parseDate(value);
  if (!date) return String(value);
  const lang = known(locale);
  const dayOnly = typeof value === 'string' && DAY_ONLY.test(value);
  switch (format) {
    case 'date':
      return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', dateStyle: 'long' }).format(date);
    case 'datetime':
      return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', dateStyle: 'long', ...(dayOnly ? {} : { timeStyle: 'short' }) }).format(date);
    case 'time':
      return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', timeStyle: 'short' }).format(date);
    case 'relative':
      return relative(date, dayOnly, lang, now);
    default:
      return byMask(date, format, lang);
  }
}
