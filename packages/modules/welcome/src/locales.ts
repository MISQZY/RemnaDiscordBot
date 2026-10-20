import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      welcome: {
        description: 'Приветствия',
        show: {
          description: 'Показать настройки приветствий',
        },
        channel: {
          description: 'Выбрать канал для приветствий или прощаний',
          options: {
            kind: {
              name: 'тип',
              description: 'Какое сообщение',
              choices: { join: 'Приветствие', leave: 'Прощание' },
            },
            channel: { name: 'канал', description: 'Текстовый канал' },
          },
        },
        message: {
          description: 'Изменить текст сообщения',
          options: {
            kind: {
              name: 'тип',
              description: 'Какое сообщение',
              choices: { join: 'Приветствие', leave: 'Прощание', dm: 'Личное сообщение' },
            },
          },
        },
        enable: {
          description: 'Включить сообщение',
          options: {
            kind: {
              name: 'тип',
              description: 'Какое сообщение',
              choices: { join: 'Приветствие', leave: 'Прощание', dm: 'Личное сообщение' },
            },
          },
        },
        disable: {
          description: 'Выключить сообщение',
          options: {
            kind: {
              name: 'тип',
              description: 'Какое сообщение',
              choices: { join: 'Приветствие', leave: 'Прощание', dm: 'Личное сообщение' },
            },
          },
        },
        reset: {
          description: 'Вернуть стандартный текст',
          options: {
            kind: {
              name: 'тип',
              description: 'Какое сообщение',
              choices: { join: 'Приветствие', leave: 'Прощание', dm: 'Личное сообщение' },
            },
          },
        },
        test: {
          name: 'test',
          description: 'Отправить тестовое сообщение, как будто вы зашли или вышли',
          options: {
            kind: {
              name: 'тип',
              description: 'Какое сообщение отправить',
              choices: { join: 'Приветствие', leave: 'Прощание', dm: 'Личное сообщение' },
            },
          },
        },
        options: {
          name: 'options',
          description: 'Боты и проверка правил сервера',
          options: {
            'ignore-bots': { name: 'без-ботов', description: 'Не приветствовать ботов' },
            'wait-for-screening': { name: 'после-правил', description: 'Приветствовать после принятия правил сервера' },
          },
        },
      },
    },
    name: 'Приветствия',
    defaults: {
      join: 'Добро пожаловать на **{guild.name}**, {user.mention}! Ты наш {guild.memberCount}-й участник.',
      dm: 'Привет, {user.displayName}! Рады видеть тебя на **{guild.name}**.',
      leave: '**{user.name}** покинул сервер.',
    },
    kind: {
      join: 'Приветствие',
      leave: 'Прощание',
      dm: 'Личное сообщение',
    },
    show: {
      title: 'Настройки приветствий',
      channel: 'Канал: {channel}',
      channelMissing: '⚠️ Канал не выбран — `/welcome channel`',
      dmTarget: 'В личные сообщения новому участнику',
      embedOnly: '*(только эмбед)*',
      footer: 'Текст: /welcome message · Проверка: /welcome test · Плейсхолдеры: {placeholders}',
      options: 'Параметры',
      on: 'да',
      off: 'нет',
      ignoreBots: 'Не приветствовать ботов: {state}',
      waitForScreening: 'Ждать принятия правил: {state}',
    },
    modal: {
      title: 'Текст: {kind}',
      label: 'Текст сообщения',
      hint: 'Плейсхолдеры: {placeholders}',
    },
    reply: {
      channelSet: '{kind}: сообщения будут отправляться в {channel}. Сообщение включено.',
      noAccess: 'Бот не может писать в {channel}: выдайте ему права «Просмотр канала» и «Отправка сообщений».',
      noChannel: '{kind}: сначала выберите канал командой `/welcome channel`.',
      enabled: '{kind}: включено.',
      disabled: '{kind}: выключено.',
      reset: '{kind}: восстановлен стандартный текст.',
      saved: '{kind}: текст сохранён. Так его увидите вы:',
      empty: 'Текст сообщения не может быть пустым.',
      forbidden: 'Для этого нужно право «Управление сервером».',
    },
    test: {
      sent: 'Тестовое сообщение отправлено.',
      notSent: 'Не удалось отправить: проверьте канал в настройках модуля и права бота. Для ЛС — открыты ли у вас личные сообщения.',
    },
  },
  en: {
    commands: {
      welcome: {
        description: 'Welcome messages',
        show: {
          description: 'Show welcome settings',
        },
        channel: {
          description: 'Set the channel for welcome or farewell messages',
          options: {
            kind: {
              name: 'kind',
              description: 'Which message',
              choices: { join: 'Join', leave: 'Leave' },
            },
            channel: { name: 'channel', description: 'Text channel' },
          },
        },
        message: {
          description: 'Edit the message text',
          options: {
            kind: {
              name: 'kind',
              description: 'Which message',
              choices: { join: 'Join', leave: 'Leave', dm: 'Direct message' },
            },
          },
        },
        enable: {
          description: 'Turn a message on',
          options: {
            kind: {
              name: 'kind',
              description: 'Which message',
              choices: { join: 'Join', leave: 'Leave', dm: 'Direct message' },
            },
          },
        },
        disable: {
          description: 'Turn a message off',
          options: {
            kind: {
              name: 'kind',
              description: 'Which message',
              choices: { join: 'Join', leave: 'Leave', dm: 'Direct message' },
            },
          },
        },
        reset: {
          description: 'Restore the default text',
          options: {
            kind: {
              name: 'kind',
              description: 'Which message',
              choices: { join: 'Join', leave: 'Leave', dm: 'Direct message' },
            },
          },
        },
        test: {
          name: 'test',
          description: 'Send a test message as if you just joined or left',
          options: {
            kind: {
              name: 'kind',
              description: 'Which message to send',
              choices: { join: 'Join', leave: 'Leave', dm: 'Direct message' },
            },
          },
        },
        options: {
          name: 'options',
          description: 'Bots and Membership Screening',
          options: {
            'ignore-bots': { name: 'ignore-bots', description: 'Do not greet bots' },
            'wait-for-screening': { name: 'wait-for-screening', description: 'Greet after the server rules are accepted' },
          },
        },
      },
    },
    name: 'Welcome',
    defaults: {
      join: 'Welcome to **{guild.name}**, {user.mention}! You are member #{guild.memberCount}.',
      dm: 'Hi {user.displayName}! Glad to see you on **{guild.name}**.',
      leave: '**{user.name}** left the server.',
    },
    kind: {
      join: 'Welcome',
      leave: 'Farewell',
      dm: 'Direct message',
    },
    show: {
      title: 'Welcome settings',
      channel: 'Channel: {channel}',
      channelMissing: '⚠️ No channel selected — `/welcome channel`',
      dmTarget: 'Sent to the new member via DM',
      embedOnly: '*(embed only)*',
      footer: 'Text: /welcome message · Test: /welcome test · Placeholders: {placeholders}',
      options: 'Options',
      on: 'yes',
      off: 'no',
      ignoreBots: 'Skip bots: {state}',
      waitForScreening: 'Wait for the rules: {state}',
    },
    modal: {
      title: 'Text: {kind}',
      label: 'Message text',
      hint: 'Placeholders: {placeholders}',
    },
    reply: {
      channelSet: '{kind}: messages will be sent to {channel}. The message is turned on.',
      noAccess: 'The bot cannot post in {channel}: give it the View Channel and Send Messages permissions.',
      noChannel: '{kind}: choose a channel first with `/welcome channel`.',
      enabled: '{kind}: turned on.',
      disabled: '{kind}: turned off.',
      reset: '{kind}: the default text is restored.',
      saved: '{kind}: text saved. This is how you would see it:',
      empty: 'The message text cannot be empty.',
      forbidden: 'You need the Manage Server permission for this.',
    },
    test: {
      sent: 'Test message sent.',
      notSent: 'Could not send: check the channel in the module settings and the bot permissions. For DMs, make sure yours are open.',
    },
  },
};
