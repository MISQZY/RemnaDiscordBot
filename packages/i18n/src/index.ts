import { SUPPORTED_LOCALES, type Locale } from '@bot/contracts';
import { IntlMessageFormat } from 'intl-messageformat';

export interface Dictionary {
  [key: string]: string | Dictionary;
}

export type TranslationVars = Record<string, string | number | boolean | Date | null | undefined>;

/** Локали Discord, в которые раскладываются наши локали для `setNameLocalizations`. */
const DISCORD_LOCALES: Record<Locale, readonly string[]> = {
  ru: ['ru'],
  en: ['en-US', 'en-GB'],
};

function flatten(dict: Dictionary, prefix: string, out: Map<string, string>): void {
  for (const [key, value] of Object.entries(dict)) {
    const path = `${prefix}.${key}`;
    if (typeof value === 'string') out.set(path, value);
    else flatten(value, path, out);
  }
}

export class I18n {
  private readonly messages = new Map<Locale, Map<string, string>>();
  private readonly compiled = new Map<string, IntlMessageFormat>();

  constructor(readonly defaultLocale: Locale = 'ru') {
    for (const locale of SUPPORTED_LOCALES) this.messages.set(locale, new Map());
  }

  /** Регистрирует словари модуля; ключи получают префикс `namespace.`. */
  register(namespace: string, dictionaries: Partial<Record<Locale, Dictionary>>): void {
    for (const [locale, dict] of Object.entries(dictionaries) as [Locale, Dictionary][]) {
      flatten(dict, namespace, this.messages.get(locale)!);
    }
  }

  has(key: string, locale: Locale = this.defaultLocale): boolean {
    return this.messages.get(locale)!.has(key);
  }

  /** Перевод с фолбэком: локаль → локаль по умолчанию → сам ключ. */
  t(locale: Locale, key: string, vars?: TranslationVars): string {
    const resolved = this.messages.get(locale)!.has(key) ? locale : this.defaultLocale;
    const source = this.messages.get(resolved)!.get(key);
    if (source === undefined) return key;

    const cacheKey = `${resolved}:${key}`;
    let format = this.compiled.get(cacheKey);
    if (!format) {
      format = new IntlMessageFormat(source, resolved);
      this.compiled.set(cacheKey, format);
    }
    return String(format.format(vars));
  }

  /**
   * Строка словаря как есть, без ICU-форматирования: для шаблонов сообщений
   * с плейсхолдерами вида `{user.mention}`, которые ICU считает ошибкой.
   */
  raw(locale: Locale, key: string): string {
    return this.messages.get(locale)!.get(key) ?? this.messages.get(this.defaultLocale)!.get(key) ?? key;
  }

  /** Discord locale (`ru`, `en-US`, …) → поддерживаемая локаль. */
  resolveLocale(discordLocale: string | null | undefined): Locale {
    const base = discordLocale?.split('-')[0];
    return (SUPPORTED_LOCALES as readonly string[]).includes(base ?? '') ? (base as Locale) : this.defaultLocale;
  }

  /** Переводы ключа во все локали Discord — для имён и описаний slash-команд. */
  localizations(key: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const locale of SUPPORTED_LOCALES) {
      const value = this.messages.get(locale)!.get(key);
      if (value === undefined) continue;
      for (const discordLocale of DISCORD_LOCALES[locale]) result[discordLocale] = value;
    }
    return result;
  }
}
