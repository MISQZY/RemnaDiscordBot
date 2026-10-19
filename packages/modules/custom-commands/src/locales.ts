import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    name: 'Свои команды',
    unavailable: 'Эта команда больше недоступна.',
    notAllowed: 'Эту команду нельзя использовать здесь.',
    cooldown: 'Подождите немного перед повторным использованием.',
  },
  en: {
    name: 'Custom commands',
    unavailable: 'This command is no longer available.',
    notAllowed: 'You cannot use this command here.',
    cooldown: 'Please wait before using this again.',
  },
};
