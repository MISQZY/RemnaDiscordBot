// Durations as members type them in commands and as replies show them; shared by the modules.

import type { Locale } from '@bot/contracts';

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  с: 1,
  m: 60,
  м: 60,
  h: 3600,
  ч: 3600,
  d: 86_400,
  д: 86_400,
  w: 604_800,
  н: 604_800,
};

/** `1h30m`, `2d`, `45 мин`… → seconds; `null` when the string is not fully parsed. */
export function parseDuration(input: string): number | null {
  const compact = input.toLowerCase().replace(/\s+/g, '').replace(/мин/g, 'м');
  const pattern = /(\d+)([a-zа-я])/gu;
  let total = 0;
  let consumed = 0;
  for (const [match, value, unit] of compact.matchAll(pattern)) {
    const seconds = UNIT_SECONDS[unit!];
    if (!seconds) return null;
    total += Number(value) * seconds;
    consumed += match.length;
  }
  return consumed === compact.length && total > 0 ? total : null;
}

const LABELS: Record<Locale, [number, string][]> = {
  ru: [
    [604_800, 'н'],
    [86_400, 'д'],
    [3600, 'ч'],
    [60, 'мин'],
    [1, 'с'],
  ],
  en: [
    [604_800, 'w'],
    [86_400, 'd'],
    [3600, 'h'],
    [60, 'm'],
    [1, 's'],
  ],
};

/** 93 784 → `1д 2ч 3мин 4с` (ru) / `1d 2h 3m 4s` (en). */
export function formatDuration(seconds: number, locale: Locale): string {
  const parts: string[] = [];
  let rest = seconds;
  for (const [size, label] of LABELS[locale]) {
    const amount = Math.floor(rest / size);
    if (amount > 0) parts.push(`${amount}${label}`);
    rest %= size;
  }
  return parts.join(' ') || `0${LABELS[locale].at(-1)![1]}`;
}
