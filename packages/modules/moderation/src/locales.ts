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
        description: 'Показать кейс модерации',
        options: {
          number: {
            name: 'номер',
            description: 'Номер кейса',
          },
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
        description: 'Show a moderation case',
        options: {
          number: {
            name: 'number',
            description: 'Case number',
          },
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
    },
  },
};
