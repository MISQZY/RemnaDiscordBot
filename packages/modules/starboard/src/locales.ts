import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: { name: 'Доска избранного', jump: 'К сообщению' },
  en: { name: 'Starboard', jump: 'Jump to message' },
};
