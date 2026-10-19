import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    name: 'Основное',
    ping: {
      reply: '🏓 Понг! Gateway: {ws} мс · ответ: {roundtrip} мс',
    },
    help: {
      title: 'Команды бота',
      empty: 'Команды ещё не зарегистрированы.',
    },
  },
  en: {
    name: 'General',
    ping: {
      reply: '🏓 Pong! Gateway: {ws} ms · roundtrip: {roundtrip} ms',
    },
    help: {
      title: 'Bot commands',
      empty: 'No commands are registered yet.',
    },
  },
};
