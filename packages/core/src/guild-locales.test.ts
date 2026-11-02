import type { PrismaClient } from '@bot/db';
import { I18n } from '@bot/i18n';
import { describe, expect, it, vi } from 'vitest';
import { GuildLocales } from './guild-locales.js';

describe('guild locale loads', () => {
  it('coalesces bursts of cold reads', async () => {
    const findUnique = vi.fn(async () => ({ locale: 'ru' }));
    const locales = new GuildLocales({ guild: { findUnique } } as unknown as PrismaClient, new I18n('en'));
    const result = await Promise.all(Array.from({ length: 100 }, () => locales.get('guild')));
    expect(result.every((locale) => locale === 'ru')).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('cannot restore the old language after an invalidation during its lookup', async () => {
    let release!: (row: { locale: string }) => void;
    const findUnique = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValue({ locale: 'en' });
    const locales = new GuildLocales({ guild: { findUnique } } as unknown as PrismaClient, new I18n('en'));
    const old = locales.get('guild');
    locales.invalidate('guild');
    expect(await locales.get('guild')).toBe('en');
    release({ locale: 'ru' });
    expect(await old).toBe('ru');
    expect(await locales.get('guild')).toBe('en');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
