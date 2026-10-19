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
      empty: 'Нет доступных команд.',
      disabled: 'Выключено модулей с командами: {count} — смотрите /modules list',
    },
    language: {
      changed: 'Язык сервера: русский. На нём бот пишет журналы, анонсы и итоги модерации.',
    },
    modules: {
      title: 'Модули бота',
      hint: 'Включить: /modules enable · выключить: /modules disable',
      enabled: 'Модуль «{module}» включён.',
      disabled: 'Модуль «{module}» выключен.',
      unknown: 'Модуля «{module}» нет или его нельзя выключить.',
    },
  },
  en: {
    name: 'General',
    ping: {
      reply: '🏓 Pong! Gateway: {ws} ms · roundtrip: {roundtrip} ms',
    },
    help: {
      title: 'Bot commands',
      empty: 'No commands available.',
      disabled: 'Modules with commands that are disabled: {count} — see /modules list',
    },
    language: {
      changed: 'Server language: English. The bot uses it for logs, announcements and moderation results.',
    },
    modules: {
      title: 'Bot modules',
      hint: 'Enable: /modules enable · disable: /modules disable',
      enabled: 'The “{module}” module is enabled.',
      disabled: 'The “{module}” module is disabled.',
      unknown: 'There is no “{module}” module, or it cannot be toggled.',
    },
  },
};
