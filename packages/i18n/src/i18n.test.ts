import { describe, expect, it } from 'vitest';
import { I18n } from './index.js';

function createI18n(): I18n {
  const i18n = new I18n('ru');
  i18n.register('general', {
    ru: { ping: { reply: 'Понг! {ms} мс' }, onlyRu: 'только ru' },
    en: { ping: { reply: 'Pong! {ms} ms' } },
  });
  return i18n;
}

describe('I18n', () => {
  it('translates nested keys with variables', () => {
    const i18n = createI18n();
    expect(i18n.t('ru', 'general.ping.reply', { ms: 42 })).toBe('Понг! 42 мс');
    expect(i18n.t('en', 'general.ping.reply', { ms: 42 })).toBe('Pong! 42 ms');
  });

  it('falls back to the default locale, then to the key', () => {
    const i18n = createI18n();
    expect(i18n.t('en', 'general.onlyRu')).toBe('только ru');
    expect(i18n.t('en', 'general.missing')).toBe('general.missing');
  });

  it('resolves Discord locales', () => {
    const i18n = createI18n();
    expect(i18n.resolveLocale('en-US')).toBe('en');
    expect(i18n.resolveLocale('ru')).toBe('ru');
    expect(i18n.resolveLocale('de')).toBe('ru');
    expect(i18n.resolveLocale(null)).toBe('ru');
  });

  it('builds Discord localization maps', () => {
    const i18n = createI18n();
    expect(i18n.localizations('general.ping.reply')).toEqual({
      ru: 'Понг! {ms} мс',
      'en-US': 'Pong! {ms} ms',
      'en-GB': 'Pong! {ms} ms',
    });
  });
});
