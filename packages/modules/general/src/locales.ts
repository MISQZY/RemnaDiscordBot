import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      ping: {
        description: 'Проверить задержку бота',
      },
      help: {
        description: 'Показать доступные команды',
      },
      modules: {
        description: 'Включить или выключить модули бота',
        list: {
          name: 'list',
          description: 'Показать модули и их состояние',
        },
        enable: {
          name: 'enable',
          description: 'Включить модуль',
          options: {
            module: {
              name: 'модуль',
              description: 'Модуль',
            },
          },
        },
        disable: {
          name: 'disable',
          description: 'Выключить модуль',
          options: {
            module: {
              name: 'модуль',
              description: 'Модуль',
            },
          },
        },
      },
      language: {
        description: 'Язык сервера для публичных сообщений бота',
        options: {
          language: {
            name: 'язык',
            description: 'Язык',
            choices: {
              ru: 'Русский',
              en: 'English',
            },
          },
        },
      },
    },
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
    commands: {
      ping: {
        description: 'Check bot latency',
      },
      help: {
        description: 'Show available commands',
      },
      modules: {
        description: 'Enable or disable bot modules',
        list: {
          name: 'list',
          description: 'Show modules and their status',
        },
        enable: {
          name: 'enable',
          description: 'Enable a module',
          options: {
            module: {
              name: 'module',
              description: 'Module',
            },
          },
        },
        disable: {
          name: 'disable',
          description: 'Disable a module',
          options: {
            module: {
              name: 'module',
              description: 'Module',
            },
          },
        },
      },
      language: {
        description: 'Server language for public bot messages',
        options: {
          language: {
            name: 'language',
            description: 'Language',
            choices: {
              ru: 'Русский',
              en: 'English',
            },
          },
        },
      },
    },
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
