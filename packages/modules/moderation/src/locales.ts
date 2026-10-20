import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      ban: {
        description: 'Забанить участника',
        options: {
          user: {
            name: 'участник',
            description: 'Участник',
          },
          duration: {
            name: 'срок',
            description: 'Срок: 10м, 2ч, 7д…',
          },
          reason: {
            name: 'причина',
            description: 'Причина',
          },
          delete_days: {
            name: 'удалить_дней',
            description: 'Удалить сообщения за последние N дней',
          },
        },
      },
      unban: {
        description: 'Разбанить пользователя',
        options: {
          user: {
            name: 'участник',
            description: 'ID или упоминание',
          },
          reason: {
            name: 'причина',
            description: 'Причина',
          },
        },
      },
      kick: {
        description: 'Выгнать участника',
        options: {
          user: {
            name: 'участник',
            description: 'Участник',
          },
          reason: {
            name: 'причина',
            description: 'Причина',
          },
        },
      },
      mute: {
        description: 'Замутить участника (тайм-аут)',
        options: {
          user: {
            name: 'участник',
            description: 'Участник',
          },
          duration: {
            name: 'срок',
            description: 'Срок: 10м, 2ч, 7д…',
          },
          reason: {
            name: 'причина',
            description: 'Причина',
          },
        },
      },
      unmute: {
        description: 'Снять тайм-аут',
        options: {
          user: {
            name: 'участник',
            description: 'Участник',
          },
          reason: {
            name: 'причина',
            description: 'Причина',
          },
        },
      },
      warn: {
        description: 'Выдать предупреждение',
        options: {
          user: {
            name: 'участник',
            description: 'Участник',
          },
          reason: {
            name: 'причина',
            description: 'Причина',
          },
        },
      },
      warns: {
        description: 'Активные предупреждения участника',
        options: {
          user: {
            name: 'участник',
            description: 'Участник',
          },
        },
      },
      unwarn: {
        description: 'Снять предупреждение',
        options: {
          case: {
            name: 'кейс',
            description: 'Номер кейса',
          },
          reason: {
            name: 'причина',
            description: 'Причина',
          },
        },
      },
      case: {
        description: 'Кейсы модерации',
        show: { name: 'show', description: 'Показать кейс модерации', options: { number: { name: 'номер', description: 'Номер кейса' } } },
        reason: {
          name: 'reason',
          description: 'Изменить причину кейса',
          options: { number: { name: 'номер', description: 'Номер кейса' }, reason: { name: 'причина', description: 'Новая причина' } },
        },
      },
      modsettings: {
        description: 'Настроить модерацию',
        show: { name: 'show', description: 'Показать настройки модерации' },
        'log-channel': {
          name: 'log-channel',
          description: 'Канал журнала кейсов; пусто — без журнала',
          options: { channel: { name: 'канал', description: 'Канал' } },
        },
        dm: { name: 'dm', description: 'Сообщать участникам о наказаниях в ЛС', options: { enabled: { name: 'включено', description: 'Отправлять ЛС' } } },
        'require-reason': {
          name: 'require-reason',
          description: 'Сделать причину обязательной',
          options: { enabled: { name: 'включено', description: 'Причина обязательна' } },
        },
        'warn-expiry': {
          name: 'warn-expiry',
          description: 'Через сколько дней предупреждения перестают учитываться',
          options: { days: { name: 'дней', description: 'Дней; 0 — никогда' } },
        },
        escalation: {
          name: 'escalation',
          description: 'Автоматические наказания за предупреждения',
          add: {
            name: 'add',
            description: 'Наказывать автоматически при числе предупреждений',
            options: {
              warns: { name: 'предупреждений', description: 'Активных предупреждений' },
              action: { name: 'действие', description: 'Наказание', choices: { mute: 'Мут', kick: 'Кик', ban: 'Бан' } },
              duration: { name: 'срок', description: 'Срок: 10м, 2ч, 7д… (обязателен для мута)' },
            },
          },
          remove: {
            name: 'remove',
            description: 'Убрать автоматическое наказание',
            options: { warns: { name: 'предупреждений', description: 'Активных предупреждений' } },
          },
        },
      },
      slowmode: {
        description: 'Включить медленный режим в канале',
        options: {
          interval: { name: 'интервал', description: 'Интервал: 10с, 5м, 1ч; 0 — выключить' },
          channel: { name: 'канал', description: 'Канал; по умолчанию текущий' },
          reason: { name: 'причина', description: 'Причина' },
        },
      },
      clear: {
        description: 'Удалить последние сообщения',
        options: {
          amount: {
            name: 'количество',
            description: 'Сколько',
          },
          user: {
            name: 'участник',
            description: 'Только этого участника',
          },
        },
      },
    },
    name: 'Модерация',
    actions: { ban: 'Бан', unban: 'Разбан', kick: 'Кик', mute: 'Мут', unmute: 'Снятие мута', warn: 'Предупреждение' },
    case: {
      title: 'Кейс #{number} · {action}',
      target: 'Участник',
      moderator: 'Модератор',
      duration: 'Срок',
      reason: 'Причина',
      noReason: 'не указана',
      system: 'Автоматически',
    },
    done: {
      ban: '**{user}** забанен · кейс #{number}',
      unban: '**{user}** разбанен · кейс #{number}',
      kick: '**{user}** выгнан с сервера · кейс #{number}',
      mute: '**{user}** замучен · кейс #{number}',
      unmute: 'С **{user}** снят мут · кейс #{number}',
      warn: '**{user}** получил предупреждение · кейс #{number}',
      escalated: 'Достигнут порог предупреждений — автоматически: {action} · кейс #{number}',
      unwarn: 'Предупреждение #{number} снято.',
      clear: 'Удалено сообщений: {count}.',
      reason: 'Причина кейса #{number} обновлена.',
      slowmode: 'Медленный режим в {channel}: {interval}.',
      slowmodeOff: 'Медленный режим в {channel} выключен.',
    },
    dm: {
      ban: 'Вы забанены на сервере **{guild}**.',
      kick: 'Вас выгнали с сервера **{guild}**.',
      mute: 'Вам выдан мут на сервере **{guild}**.',
      warn: 'Вы получили предупреждение на сервере **{guild}**.',
      duration: 'Срок: {duration}',
      reason: 'Причина: {reason}',
    },
    warnsTitle: 'Активные предупреждения **{user}** ({count}):',
    noWarns: 'Активных предупреждений нет.',
    escalationReason: 'Автоматически: {count, plural, one {# предупреждение} few {# предупреждения} other {# предупреждений}}',
    errors: {
      self: 'Нельзя применить это к себе.',
      owner: 'Нельзя наказать владельца сервера.',
      bot: 'Нельзя наказать бота модерации.',
      hierarchy: 'Роль участника не ниже вашей.',
      botHierarchy: 'Роль участника не ниже роли бота или у бота нет нужного права.',
      reasonRequired: 'На этом сервере причина обязательна.',
      invalidDuration: 'Не удалось разобрать срок. Примеры: 10м, 2ч, 7д, 1h30m.',
      notMember: 'Этого пользователя нет на сервере.',
      notWarning: 'Кейс с таким номером не является предупреждением.',
      caseNotFound: 'Кейс не найден.',
      notYourCase: 'Причину может изменить автор кейса или управляющий сервером.',
      invalidSlowmode: 'Не удалось разобрать интервал: от 1с до 6ч, например 10с, 5м, 1ч; 0 — выключить.',
      noSlowmode: 'В этом канале нельзя включить медленный режим.',
      noSlowmodeAccess: 'У бота нет права «Управлять каналом» в {channel}.',
    },
    settings: {
      on: 'включено',
      off: 'выключено',
      never: 'никогда',
      days: '{days, plural, one {# день} few {# дня} other {# дней}}',
      logChannel: 'Журнал кейсов',
      dm: 'ЛС о наказаниях',
      requireReason: 'Причина обязательна',
      warnExpiry: 'Срок предупреждений',
      escalation: 'Эскалация',
      rule: '{warns, plural, one {# предупреждение} few {# предупреждения} other {# предупреждений}} → {action}',
      invalid: 'Настройки не сохранены: {error}',
      noAccess: 'Бот не может писать в {channel}: нужны права «Просмотр канала», «Отправка сообщений» и «Встраивать ссылки».',
      logSet: 'Кейсы записываются в {channel}.',
      logOff: 'Журнал кейсов выключен.',
      dmSet: 'ЛС о наказаниях: {state}.',
      requireReasonSet: 'Обязательная причина: {state}.',
      expirySet: 'Предупреждения учитываются {days, plural, one {# день} few {# дня} other {# дней}}.',
      expiryNever: 'Предупреждения учитываются бессрочно.',
      badRuleDuration: 'Укажите срок, например 1ч или 7д; для мута — не больше 28 дней.',
      ruleSet: 'Правило сохранено: {rule}.',
      noRule: 'Правила для {warns, plural, one {# предупреждения} other {# предупреждений}} нет.',
      ruleRemoved: 'Правило для {warns, plural, one {# предупреждения} other {# предупреждений}} удалено.',
    },
  },
  en: {
    commands: {
      ban: {
        description: 'Ban a member',
        options: {
          user: {
            name: 'user',
            description: 'Member',
          },
          duration: {
            name: 'duration',
            description: 'Duration: 10m, 2h, 7d…',
          },
          reason: {
            name: 'reason',
            description: 'Reason',
          },
          delete_days: {
            name: 'delete_days',
            description: 'Delete messages from the last N days',
          },
        },
      },
      unban: {
        description: 'Unban a user',
        options: {
          user: {
            name: 'user',
            description: 'User ID or mention',
          },
          reason: {
            name: 'reason',
            description: 'Reason',
          },
        },
      },
      kick: {
        description: 'Kick a member',
        options: {
          user: {
            name: 'user',
            description: 'Member',
          },
          reason: {
            name: 'reason',
            description: 'Reason',
          },
        },
      },
      mute: {
        description: 'Time out a member',
        options: {
          user: {
            name: 'user',
            description: 'Member',
          },
          duration: {
            name: 'duration',
            description: 'Duration: 10m, 2h, 7d…',
          },
          reason: {
            name: 'reason',
            description: 'Reason',
          },
        },
      },
      unmute: {
        description: 'Remove a time out',
        options: {
          user: {
            name: 'user',
            description: 'Member',
          },
          reason: {
            name: 'reason',
            description: 'Reason',
          },
        },
      },
      warn: {
        description: 'Warn a member',
        options: {
          user: {
            name: 'user',
            description: 'Member',
          },
          reason: {
            name: 'reason',
            description: 'Reason',
          },
        },
      },
      warns: {
        description: 'Active warnings of a member',
        options: {
          user: {
            name: 'user',
            description: 'Member',
          },
        },
      },
      unwarn: {
        description: 'Remove a warning',
        options: {
          case: {
            name: 'case',
            description: 'Warning case number',
          },
          reason: {
            name: 'reason',
            description: 'Reason',
          },
        },
      },
      case: {
        description: 'Moderation cases',
        show: { name: 'show', description: 'Show a moderation case', options: { number: { name: 'number', description: 'Case number' } } },
        reason: {
          name: 'reason',
          description: 'Change the reason of a case',
          options: { number: { name: 'number', description: 'Case number' }, reason: { name: 'reason', description: 'New reason' } },
        },
      },
      modsettings: {
        description: 'Configure moderation',
        show: { name: 'show', description: 'Show moderation settings' },
        'log-channel': {
          name: 'log-channel',
          description: 'Channel for the case log; empty — no log',
          options: { channel: { name: 'channel', description: 'Channel' } },
        },
        dm: { name: 'dm', description: 'DM members about their punishments', options: { enabled: { name: 'enabled', description: 'Send DMs' } } },
        'require-reason': {
          name: 'require-reason',
          description: 'Make the reason mandatory',
          options: { enabled: { name: 'enabled', description: 'Reason is required' } },
        },
        'warn-expiry': {
          name: 'warn-expiry',
          description: 'After how many days warnings stop counting',
          options: { days: { name: 'days', description: 'Days; 0 — never' } },
        },
        escalation: {
          name: 'escalation',
          description: 'Automatic punishments for warnings',
          add: {
            name: 'add',
            description: 'Punish automatically at a number of warnings',
            options: {
              warns: { name: 'warns', description: 'Active warnings' },
              action: { name: 'action', description: 'Punishment', choices: { mute: 'Mute', kick: 'Kick', ban: 'Ban' } },
              duration: { name: 'duration', description: 'Duration: 10m, 2h, 7d… (required for mutes)' },
            },
          },
          remove: {
            name: 'remove',
            description: 'Remove an automatic punishment',
            options: { warns: { name: 'warns', description: 'Active warnings' } },
          },
        },
      },
      slowmode: {
        description: 'Set the channel slowmode',
        options: {
          interval: { name: 'interval', description: 'Interval: 10s, 5m, 1h; 0 — off' },
          channel: { name: 'channel', description: 'Channel; the current one by default' },
          reason: { name: 'reason', description: 'Reason' },
        },
      },
      clear: {
        description: 'Delete recent messages',
        options: {
          amount: {
            name: 'amount',
            description: 'How many',
          },
          user: {
            name: 'user',
            description: 'Only from this member',
          },
        },
      },
    },
    name: 'Moderation',
    actions: { ban: 'Ban', unban: 'Unban', kick: 'Kick', mute: 'Mute', unmute: 'Unmute', warn: 'Warning' },
    case: {
      title: 'Case #{number} · {action}',
      target: 'Member',
      moderator: 'Moderator',
      duration: 'Duration',
      reason: 'Reason',
      noReason: 'not specified',
      system: 'Automatic',
    },
    done: {
      ban: '**{user}** was banned · case #{number}',
      unban: '**{user}** was unbanned · case #{number}',
      kick: '**{user}** was kicked · case #{number}',
      mute: '**{user}** was muted · case #{number}',
      unmute: '**{user}** was unmuted · case #{number}',
      warn: '**{user}** was warned · case #{number}',
      escalated: 'Warning threshold reached — automatic {action} · case #{number}',
      unwarn: 'Warning #{number} removed.',
      clear: 'Deleted {count} messages.',
      reason: 'Reason of case #{number} updated.',
      slowmode: 'Slowmode in {channel}: {interval}.',
      slowmodeOff: 'Slowmode in {channel} is off.',
    },
    dm: {
      ban: 'You were banned from **{guild}**.',
      kick: 'You were kicked from **{guild}**.',
      mute: 'You were muted in **{guild}**.',
      warn: 'You received a warning in **{guild}**.',
      duration: 'Duration: {duration}',
      reason: 'Reason: {reason}',
    },
    warnsTitle: 'Active warnings of **{user}** ({count}):',
    noWarns: 'No active warnings.',
    escalationReason: 'Automatic: {count, plural, one {# warning} other {# warnings}}',
    errors: {
      self: 'You cannot do this to yourself.',
      owner: 'You cannot punish the server owner.',
      bot: 'You cannot punish the moderation bot.',
      hierarchy: "The member's role is not lower than yours.",
      botHierarchy: "The member's role is not lower than the bot's, or the bot lacks the permission.",
      reasonRequired: 'A reason is required on this server.',
      invalidDuration: 'Could not parse the duration. Examples: 10m, 2h, 7d, 1h30m.',
      notMember: 'This user is not on the server.',
      notWarning: 'This case is not a warning.',
      caseNotFound: 'Case not found.',
      notYourCase: 'Only the case author or a server manager can change the reason.',
      invalidSlowmode: 'Could not read the interval: from 1s to 6h, e.g. 10s, 5m, 1h; 0 — off.',
      noSlowmode: 'Slowmode is not available in this channel.',
      noSlowmodeAccess: 'The bot lacks Manage Channel in {channel}.',
    },
    settings: {
      on: 'on',
      off: 'off',
      never: 'never',
      days: '{days, plural, one {# day} other {# days}}',
      logChannel: 'Case log',
      dm: 'Punishment DMs',
      requireReason: 'Reason required',
      warnExpiry: 'Warning lifetime',
      escalation: 'Escalation',
      rule: '{warns, plural, one {# warning} other {# warnings}} → {action}',
      invalid: 'Settings not saved: {error}',
      noAccess: 'The bot cannot post in {channel}: it needs View Channel, Send Messages and Embed Links.',
      logSet: 'Cases are logged to {channel}.',
      logOff: 'The case log is off.',
      dmSet: 'Punishment DMs: {state}.',
      requireReasonSet: 'Mandatory reason: {state}.',
      expirySet: 'Warnings count for {days, plural, one {# day} other {# days}}.',
      expiryNever: 'Warnings never expire.',
      badRuleDuration: 'Give a duration such as 1h or 7d; at most 28 days for mutes.',
      ruleSet: 'Rule saved: {rule}.',
      noRule: 'There is no rule for {warns, plural, one {# warning} other {# warnings}}.',
      ruleRemoved: 'Rule for {warns, plural, one {# warning} other {# warnings}} removed.',
    },
  },
};
