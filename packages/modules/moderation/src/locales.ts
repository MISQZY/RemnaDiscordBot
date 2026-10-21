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
        appeal: {
          name: 'appeal',
          description: 'Ссылка для обжалования в ЛС о наказании; пусто — без неё',
          options: { url: { name: 'ссылка', description: 'https://…' } },
        },
        'dm-note': {
          name: 'dm-note',
          description: 'Дополнительный текст ЛС о наказании; пусто — без него',
          options: { text: { name: 'текст', description: 'Текст' } },
        },
        reports: {
          name: 'reports',
          description: 'Куда приходят жалобы из меню сообщения; пусто — жалобы выключены',
          options: { channel: { name: 'канал', description: 'Канал' }, role: { name: 'роль', description: 'Роль, которую упоминать в каждой жалобе' } },
        },
        'native-cases': {
          name: 'native-cases',
          description: 'Записывать кейсы за баны, кики и тайм-ауты из самого Discord',
          options: { enabled: { name: 'включено', description: 'Записывать' } },
        },
        honeypot: {
          name: 'honeypot',
          description: 'Канал-ловушка: кто в нём пишет, считается спам-ботом; пусто — выключить',
          options: {
            channel: { name: 'канал', description: 'Канал' },
            action: { name: 'действие', description: 'Что с ними делать', choices: { softban: 'Софтбан', ban: 'Бан', kick: 'Кик', mute: 'Мут' } },
          },
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
          filter: {
            name: 'фильтр',
            description: 'Только такие сообщения',
            choices: { bots: 'От ботов', humans: 'От людей', links: 'Со ссылками', attachments: 'С файлами', invites: 'С приглашениями' },
          },
          contains: { name: 'текст', description: 'Только сообщения с этим текстом' },
        },
      },
      note: {
        description: 'Добавить заметку об участнике в его историю',
        options: { user: { name: 'участник', description: 'Участник' }, text: { name: 'текст', description: 'Заметка' } },
      },
      history: {
        description: 'Все кейсы и заметки участника',
        options: { user: { name: 'участник', description: 'Участник' } },
      },
      lockdown: {
        description: 'Запретить @everyone писать в каналах',
        channel: {
          name: 'channel',
          description: 'Закрыть один канал',
          options: {
            channel: { name: 'канал', description: 'Канал; по умолчанию текущий' },
            duration: { name: 'срок', description: 'Открыть через: 10м, 2ч…; пусто — до /unlock' },
            reason: { name: 'причина', description: 'Причина' },
          },
        },
        server: {
          name: 'server',
          description: 'Закрыть все открытые каналы (или выбранные в настройках)',
          options: {
            duration: { name: 'срок', description: 'Открыть через: 10м, 2ч…; пусто — до /unlock' },
            reason: { name: 'причина', description: 'Причина' },
          },
        },
      },
      unlock: {
        description: 'Снять блокировку каналов',
        channel: {
          name: 'channel',
          description: 'Открыть один канал',
          options: { channel: { name: 'канал', description: 'Канал; по умолчанию текущий' } },
        },
        server: { name: 'server', description: 'Открыть все каналы, закрытые ботом' },
      },
    },
    contextMenus: { warn: 'Предупредить', mute: 'Замутить', history: 'История модерации', report: 'Пожаловаться' },
    name: 'Модерация',
    actions: { ban: 'Бан', unban: 'Разбан', kick: 'Кик', mute: 'Мут', unmute: 'Снятие мута', warn: 'Предупреждение', note: 'Заметка' },
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
      note: 'Заметка об **{user}** сохранена · кейс #{number}',
    },
    history: {
      title: 'История **{user}** (последние {count}):',
      empty: 'У **{user}** нет кейсов и заметок.',
    },
    menus: {
      reason: 'Причина',
      duration: 'Срок',
      warnTitle: 'Предупреждение: {user}',
      muteTitle: 'Мут: {user}',
    },
    report: {
      off: 'Жалобы на этом сервере выключены.',
      own: 'Нельзя пожаловаться на своё сообщение.',
      title: 'Жалоба на сообщение',
      gone: 'Сообщение уже удалено.',
      embedTitle: 'Жалоба на сообщение',
      noText: 'без текста',
      author: 'Автор',
      channel: 'Канал',
      by: 'Пожаловался',
      reason: 'Причина',
      delete: 'Удалить сообщение',
      done: 'Рассмотрено',
      open: 'Перейти',
      sent: 'Жалоба отправлена модераторам. Спасибо!',
      handledBy: 'Рассмотрел {user}',
      deleted: 'сообщение удалено',
    },
    lockdown: {
      locked: 'Закрыто {count, plural, one {# канал} few {# канала} other {# каналов}}: {channels}',
      unlocked: 'Открыто {count, plural, one {# канал} few {# канала} other {# каналов}}: {channels}',
      for: 'Откроются автоматически через {duration}.',
      skipped: 'Уже были закрыты: {count}.',
      failed: 'Не удалось закрыть (нет права «Управлять ролями» в канале): {channels}',
      nothing: 'Здесь нет каналов, закрытых ботом.',
      notice: '🔒 Канал временно закрыт модераторами.',
      reason: 'Причина: {reason}',
      until: 'Откроется {time}.',
      lifted: '🔓 Канал снова открыт.',
    },
    dm: {
      ban: 'Вы забанены на сервере **{guild}**.',
      kick: 'Вас выгнали с сервера **{guild}**.',
      mute: 'Вам выдан мут на сервере **{guild}**.',
      warn: 'Вы получили предупреждение на сервере **{guild}**.',
      duration: 'Срок: {duration}',
      reason: 'Причина: {reason}',
      appeal: 'Обжаловать наказание: {url}',
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
      noPermission: 'У вас нет права на это действие.',
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
      appeal: 'Обжалование',
      reports: 'Жалобы',
      nativeCases: 'Кейсы за действия в Discord',
      badUrl: 'Ссылка должна начинаться с http:// или https://.',
      appealSet: 'В ЛС о наказании будет ссылка: {url}',
      appealOff: 'Ссылка на обжалование убрана.',
      dmNoteSet: 'Текст ЛС о наказании сохранён.',
      dmNoteOff: 'Дополнительный текст ЛС убран.',
      reportsSet: 'Жалобы приходят в {channel}.',
      reportsOff: 'Жалобы выключены.',
      nativeCasesSet: 'Кейсы за баны, кики и тайм-ауты из Discord: {state}.',
      honeypot: 'Канал-ловушка',
      honeypotAccess: 'В {channel} боту нужны права «Просмотр канала» и «Управлять сообщениями».',
      honeypotSet: 'Канал-ловушка: {channel}. Кто в нём напишет — {action}.',
      honeypotOff: 'Канал-ловушка выключен.',
    },
    honeypot: {
      reason: 'Канал-ловушка: похоже на спам-бота',
      actions: { softban: 'софтбан', ban: 'бан', kick: 'кик', mute: 'мут' },
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
        appeal: {
          name: 'appeal',
          description: 'Link to appeal a punishment, shown in the DM; empty — none',
          options: { url: { name: 'url', description: 'https://…' } },
        },
        'dm-note': {
          name: 'dm-note',
          description: 'Extra text of the punishment DM; empty — none',
          options: { text: { name: 'text', description: 'Text' } },
        },
        reports: {
          name: 'reports',
          description: 'Where reports from the message menu go; empty — reports are off',
          options: { channel: { name: 'channel', description: 'Channel' }, role: { name: 'role', description: 'Role to ping with each report' } },
        },
        'native-cases': {
          name: 'native-cases',
          description: 'Record cases for bans, kicks and timeouts done in Discord itself',
          options: { enabled: { name: 'enabled', description: 'Record them' } },
        },
        honeypot: {
          name: 'honeypot',
          description: 'A channel where whoever writes is taken for a spam bot; empty — off',
          options: {
            channel: { name: 'channel', description: 'Channel' },
            action: { name: 'action', description: 'What to do with them', choices: { softban: 'Softban', ban: 'Ban', kick: 'Kick', mute: 'Mute' } },
          },
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
          filter: {
            name: 'filter',
            description: 'Only these messages',
            choices: { bots: 'From bots', humans: 'From people', links: 'With links', attachments: 'With files', invites: 'With invites' },
          },
          contains: { name: 'contains', description: 'Only messages with this text' },
        },
      },
      note: {
        description: 'Add a note about a member to their history',
        options: { user: { name: 'user', description: 'Member' }, text: { name: 'text', description: 'Note' } },
      },
      history: {
        description: 'All cases and notes of a member',
        options: { user: { name: 'user', description: 'Member' } },
      },
      lockdown: {
        description: 'Stop @everyone from writing in channels',
        channel: {
          name: 'channel',
          description: 'Lock one channel',
          options: {
            channel: { name: 'channel', description: 'Channel; the current one by default' },
            duration: { name: 'duration', description: 'Unlock after: 10m, 2h…; empty — until /unlock' },
            reason: { name: 'reason', description: 'Reason' },
          },
        },
        server: {
          name: 'server',
          description: 'Lock every public channel (or the ones from the settings)',
          options: {
            duration: { name: 'duration', description: 'Unlock after: 10m, 2h…; empty — until /unlock' },
            reason: { name: 'reason', description: 'Reason' },
          },
        },
      },
      unlock: {
        description: 'Lift a lockdown',
        channel: {
          name: 'channel',
          description: 'Unlock one channel',
          options: { channel: { name: 'channel', description: 'Channel; the current one by default' } },
        },
        server: { name: 'server', description: 'Unlock every channel the bot locked' },
      },
    },
    contextMenus: { warn: 'Warn', mute: 'Mute', history: 'Moderation history', report: 'Report message' },
    name: 'Moderation',
    actions: { ban: 'Ban', unban: 'Unban', kick: 'Kick', mute: 'Mute', unmute: 'Unmute', warn: 'Warning', note: 'Note' },
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
      note: 'Note about **{user}** saved · case #{number}',
    },
    history: {
      title: 'History of **{user}** (last {count}):',
      empty: '**{user}** has no cases or notes.',
    },
    menus: {
      reason: 'Reason',
      duration: 'Duration',
      warnTitle: 'Warn {user}',
      muteTitle: 'Mute {user}',
    },
    report: {
      off: 'Reports are off on this server.',
      own: 'You cannot report your own message.',
      title: 'Report a message',
      gone: 'The message is already deleted.',
      embedTitle: 'Message report',
      noText: 'no text',
      author: 'Author',
      channel: 'Channel',
      by: 'Reported by',
      reason: 'Reason',
      delete: 'Delete message',
      done: 'Handled',
      open: 'Open',
      sent: 'Your report was sent to the moderators. Thank you!',
      handledBy: 'Handled by {user}',
      deleted: 'message deleted',
    },
    lockdown: {
      locked: 'Locked {count, plural, one {# channel} other {# channels}}: {channels}',
      unlocked: 'Unlocked {count, plural, one {# channel} other {# channels}}: {channels}',
      for: 'They unlock automatically in {duration}.',
      skipped: 'Already locked: {count}.',
      failed: 'Could not lock (no Manage Roles in the channel): {channels}',
      nothing: 'There are no channels locked by the bot here.',
      notice: '🔒 This channel is temporarily locked by the moderators.',
      reason: 'Reason: {reason}',
      until: 'It opens {time}.',
      lifted: '🔓 This channel is open again.',
    },
    dm: {
      ban: 'You were banned from **{guild}**.',
      kick: 'You were kicked from **{guild}**.',
      mute: 'You were muted in **{guild}**.',
      warn: 'You received a warning in **{guild}**.',
      duration: 'Duration: {duration}',
      reason: 'Reason: {reason}',
      appeal: 'Appeal: {url}',
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
      noPermission: 'You do not have permission for this.',
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
      appeal: 'Appeals',
      reports: 'Reports',
      nativeCases: 'Cases for actions in Discord',
      badUrl: 'The link must start with http:// or https://.',
      appealSet: 'Punishment DMs will include: {url}',
      appealOff: 'Appeal link removed.',
      dmNoteSet: 'Punishment DM text saved.',
      dmNoteOff: 'Extra DM text removed.',
      reportsSet: 'Reports go to {channel}.',
      reportsOff: 'Reports are off.',
      nativeCasesSet: 'Cases for bans, kicks and timeouts from Discord: {state}.',
      honeypot: 'Honeypot channel',
      honeypotAccess: 'The bot needs View Channel and Manage Messages in {channel}.',
      honeypotSet: 'Honeypot channel: {channel}. Whoever writes there gets: {action}.',
      honeypotOff: 'The honeypot channel is off.',
    },
    honeypot: {
      reason: 'Honeypot channel: looks like a spam bot',
      actions: { softban: 'softban', ban: 'ban', kick: 'kick', mute: 'mute' },
    },
  },
};
