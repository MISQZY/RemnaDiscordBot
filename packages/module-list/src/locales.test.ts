import { SUPPORTED_LOCALES } from '@bot/contracts';
import { coreLocales } from '@bot/core';
import type { Dictionary } from '@bot/i18n';
import { describe, expect, it } from 'vitest';
import { modules } from './index.js';

function keys(dict: Dictionary | undefined, prefix = ''): string[] {
  return Object.entries(dict ?? {}).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
}

/** Placeholders like `{count}` or `{user.mention}` must match across translations. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([\w.]+)/g)].map((m) => m[1]!).sort();
}

function lookup(dict: Dictionary | undefined, path: string): string | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of path.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  return typeof node === 'string' ? node : undefined;
}

const dictionaries = [
  { id: 'core', locales: coreLocales as Partial<Record<string, Dictionary>> },
  ...modules.map((m) => ({ id: m.id, locales: (m.locales ?? {}) as Partial<Record<string, Dictionary>> })),
];

describe('locale dictionaries', () => {
  it.each(dictionaries)('$id has the same keys in every language', ({ locales }) => {
    const [base, ...others] = SUPPORTED_LOCALES.map((locale) => keys(locales[locale]).sort());
    for (const other of others) expect(other).toEqual(base);
  });

  it.each(dictionaries)('$id uses the same placeholders in every language', ({ locales }) => {
    for (const key of keys(locales[SUPPORTED_LOCALES[0]])) {
      const expected = placeholders(lookup(locales[SUPPORTED_LOCALES[0]], key)!);
      for (const locale of SUPPORTED_LOCALES.slice(1)) {
        expect(placeholders(lookup(locales[locale], key) ?? ''), `${key} (${locale})`).toEqual(expected);
      }
    }
  });

  it('gives every module a localized name', () => {
    for (const module of modules) {
      for (const locale of SUPPORTED_LOCALES) expect(lookup(module.locales?.[locale], 'name'), `${module.id} (${locale})`).toBeTruthy();
    }
  });
});
