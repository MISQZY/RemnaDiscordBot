import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      rank: {
        description: 'Показать уровень и опыт',
        options: {
          user: {
            name: 'участник',
            description: 'Участник',
          },
        },
      },
      leaderboard: {
        description: 'Лучшие участники по опыту',
      },
      levels: {
        description: 'Настроить уровни',
        show: { name: 'show', description: 'Показать настройки уровней' },
        xp: {
          name: 'xp',
          description: 'Опыт за сообщение и кулдаун',
          options: {
            min: { name: 'минимум', description: 'Минимум опыта' },
            max: { name: 'максимум', description: 'Максимум опыта' },
            cooldown: { name: 'кулдаун', description: 'Секунд между засчитанными сообщениями' },
          },
        },
        announce: {
          name: 'announce',
          description: 'Куда объявлять о новом уровне',
          options: {
            mode: {
              name: 'режим',
              description: 'Куда',
              choices: { off: 'Выключено', current: 'В тот же канал', channel: 'В выбранный канал', dm: 'В личные сообщения' },
            },
            channel: { name: 'канал', description: 'Канал для режима «В выбранный канал»' },
            message: { name: 'текст', description: 'Текст: {user.mention}, {level}, {xp}…' },
          },
        },
        rewards: {
          name: 'rewards',
          description: 'Роли за достижение уровней',
          add: {
            name: 'add',
            description: 'Выдавать роль на уровне',
            options: { level: { name: 'уровень', description: 'Уровень' }, role: { name: 'роль', description: 'Роль' } },
          },
          remove: { name: 'remove', description: 'Убрать награду уровня', options: { level: { name: 'уровень', description: 'Уровень' } } },
          stack: {
            name: 'stack',
            description: 'Оставлять роли прошлых уровней',
            options: { enabled: { name: 'включено', description: 'Оставлять прошлые награды' } },
          },
        },
        ignore: {
          name: 'ignore',
          description: 'Каналы и роли без опыта',
          add: {
            name: 'add',
            description: 'Не давать опыт в канале или роли',
            options: { channel: { name: 'канал', description: 'Канал' }, role: { name: 'роль', description: 'Роль' } },
          },
          remove: {
            name: 'remove',
            description: 'Снова давать опыт в канале или роли',
            options: { channel: { name: 'канал', description: 'Канал' }, role: { name: 'роль', description: 'Роль' } },
          },
        },
        multiplier: {
          name: 'multiplier',
          description: 'Множители опыта для ролей и каналов',
          set: {
            name: 'set',
            description: 'Умножать опыт для роли или в канале',
            options: {
              value: { name: 'множитель', description: 'Множитель, например 1.5; 0 — без опыта' },
              role: { name: 'роль', description: 'Роль' },
              channel: { name: 'канал', description: 'Канал' },
            },
          },
          remove: {
            name: 'remove',
            description: 'Убрать множитель',
            options: { role: { name: 'роль', description: 'Роль' }, channel: { name: 'канал', description: 'Канал' } },
          },
        },
        public: {
          name: 'public',
          description: 'Публиковать рейтинг на сайте',
          options: { enabled: { name: 'включено', description: 'Публичный рейтинг' } },
        },
        reset: { name: 'reset', description: 'Сбросить опыт участника', options: { user: { name: 'участник', description: 'Участник' } } },
      },
      xp: {
        description: 'Изменить опыт участника',
        options: {
          action: {
            name: 'действие',
            description: 'Что сделать',
            choices: {
              add: 'Добавить',
              remove: 'Отнять',
              set: 'Установить',
            },
          },
          user: {
            name: 'участник',
            description: 'Участник',
          },
          amount: {
            name: 'количество',
            description: 'Опыт',
          },
        },
      },
    },
    name: 'Уровни',
    defaults: { levelUp: '{user.mention} достиг уровня **{level}**! 🎉' },
    fields: { level: 'Уровень', rank: 'Место', messages: 'Сообщений', progress: 'Прогресс' },
    levelShort: 'ур. {level}',
    leaderboardTitle: 'Рейтинг участников',
    leaderboardEmpty: 'Пока никто не набрал опыта.',
    page: 'Страница {page} из {pages}',
    noXp: 'У **{user}** пока нет опыта.',
    xpChanged: 'Опыт **{user}**: {xp} XP, уровень {level}.',
    settings: {
      none: '—',
      on: 'включено',
      off: 'выключено',
      invalid: 'Настройки не сохранены: {error}',
      xp: 'Опыт',
      xpValue: '{min}–{max} за сообщение, не чаще раза в {cooldown} с',
      announce: 'Объявления',
      announceModes: { off: 'выключены', current: 'в тот же канал', channel: 'в канал', dm: 'в ЛС' },
      stack: 'Копить награды',
      public: 'Публичный рейтинг',
      rewards: 'Награды',
      reward: 'Уровень {level} → {role}',
      multipliers: 'Множители',
      ignoredList: 'Без опыта',
      minAboveMax: 'Минимум не может быть больше максимума.',
      xpSet: 'Опыт за сообщение: {min}–{max}.',
      pickChannel: 'Укажите канал для объявлений.',
      noAccess: 'Бот не может писать в {channel}.',
      announceSet: 'Объявления о новом уровне: {mode}.',
      stackSet: 'Награды прошлых уровней остаются: {state}.',
      noReward: 'У уровня {level} нет награды.',
      rewardRemoved: 'Награда уровня {level} убрана.',
      rewardSet: 'На уровне {level} выдаётся роль **{role}**.',
      roleNotAssignable: 'Роль **{role}** нельзя выдать: она встроенная или управляется интеграцией.',
      roleTooHigh: 'Роль **{role}** выше роли бота — он не сможет её выдать.',
      pickTarget: 'Укажите канал или роль.',
      pickOne: 'Укажите что-то одно: роль или канал.',
      ignored: 'Без опыта: {targets}.',
      unignored: 'Снова с опытом: {targets}.',
      multiplierSet: 'Множитель для {target}: ×{value}.',
      multiplierRemoved: 'Множитель для {target} убран.',
      publicSet: 'Публичный рейтинг: {state}.',
      reset: 'Опыт **{user}** сброшен.',
      nothingToReset: 'У **{user}** нет опыта.',
    },
  },
  en: {
    commands: {
      rank: {
        description: 'Show level and XP',
        options: {
          user: {
            name: 'user',
            description: 'Member',
          },
        },
      },
      leaderboard: {
        description: 'Top members by XP',
      },
      levels: {
        description: 'Configure leveling',
        show: { name: 'show', description: 'Show leveling settings' },
        xp: {
          name: 'xp',
          description: 'XP per message and the cooldown',
          options: {
            min: { name: 'min', description: 'Minimum XP' },
            max: { name: 'max', description: 'Maximum XP' },
            cooldown: { name: 'cooldown', description: 'Seconds between rewarded messages' },
          },
        },
        announce: {
          name: 'announce',
          description: 'Where to announce level-ups',
          options: {
            mode: {
              name: 'mode',
              description: 'Where',
              choices: { off: 'Off', current: 'Same channel', channel: 'Chosen channel', dm: 'Direct message' },
            },
            channel: { name: 'channel', description: 'Channel for the "Chosen channel" mode' },
            message: { name: 'message', description: 'Text: {user.mention}, {level}, {xp}…' },
          },
        },
        rewards: {
          name: 'rewards',
          description: 'Roles for reaching levels',
          add: {
            name: 'add',
            description: 'Grant a role at a level',
            options: { level: { name: 'level', description: 'Level' }, role: { name: 'role', description: 'Role' } },
          },
          remove: { name: 'remove', description: 'Remove the reward of a level', options: { level: { name: 'level', description: 'Level' } } },
          stack: {
            name: 'stack',
            description: 'Keep the roles of previous levels',
            options: { enabled: { name: 'enabled', description: 'Keep previous rewards' } },
          },
        },
        ignore: {
          name: 'ignore',
          description: 'Channels and roles that earn no XP',
          add: {
            name: 'add',
            description: 'Stop granting XP in a channel or to a role',
            options: { channel: { name: 'channel', description: 'Channel' }, role: { name: 'role', description: 'Role' } },
          },
          remove: {
            name: 'remove',
            description: 'Grant XP in a channel or to a role again',
            options: { channel: { name: 'channel', description: 'Channel' }, role: { name: 'role', description: 'Role' } },
          },
        },
        multiplier: {
          name: 'multiplier',
          description: 'XP multipliers for roles and channels',
          set: {
            name: 'set',
            description: 'Multiply XP for a role or in a channel',
            options: {
              value: { name: 'value', description: 'Multiplier, e.g. 1.5; 0 — no XP' },
              role: { name: 'role', description: 'Role' },
              channel: { name: 'channel', description: 'Channel' },
            },
          },
          remove: {
            name: 'remove',
            description: 'Remove a multiplier',
            options: { role: { name: 'role', description: 'Role' }, channel: { name: 'channel', description: 'Channel' } },
          },
        },
        public: {
          name: 'public',
          description: 'Publish the leaderboard on the website',
          options: { enabled: { name: 'enabled', description: 'Public leaderboard' } },
        },
        reset: { name: 'reset', description: "Reset a member's XP", options: { user: { name: 'user', description: 'Member' } } },
      },
      xp: {
        description: 'Change member XP',
        options: {
          action: {
            name: 'action',
            description: 'What to do',
            choices: {
              add: 'Add',
              remove: 'Remove',
              set: 'Set',
            },
          },
          user: {
            name: 'user',
            description: 'Member',
          },
          amount: {
            name: 'amount',
            description: 'XP',
          },
        },
      },
    },
    name: 'Leveling',
    defaults: { levelUp: '{user.mention} reached level **{level}**! 🎉' },
    fields: { level: 'Level', rank: 'Rank', messages: 'Messages', progress: 'Progress' },
    levelShort: 'lvl {level}',
    leaderboardTitle: 'Leaderboard',
    leaderboardEmpty: 'Nobody has earned XP yet.',
    page: 'Page {page} of {pages}',
    noXp: '**{user}** has no XP yet.',
    xpChanged: '**{user}** now has {xp} XP, level {level}.',
    settings: {
      none: '—',
      on: 'on',
      off: 'off',
      invalid: 'Settings not saved: {error}',
      xp: 'XP',
      xpValue: '{min}–{max} per message, at most once per {cooldown} s',
      announce: 'Announcements',
      announceModes: { off: 'off', current: 'same channel', channel: 'to a channel', dm: 'via DM' },
      stack: 'Stack rewards',
      public: 'Public leaderboard',
      rewards: 'Rewards',
      reward: 'Level {level} → {role}',
      multipliers: 'Multipliers',
      ignoredList: 'No XP',
      minAboveMax: 'The minimum cannot exceed the maximum.',
      xpSet: 'XP per message: {min}–{max}.',
      pickChannel: 'Pick a channel for announcements.',
      noAccess: 'The bot cannot post in {channel}.',
      announceSet: 'Level-up announcements: {mode}.',
      stackSet: 'Rewards of previous levels are kept: {state}.',
      noReward: 'Level {level} has no reward.',
      rewardRemoved: 'Reward of level {level} removed.',
      rewardSet: 'Level {level} grants **{role}**.',
      roleNotAssignable: '**{role}** cannot be granted: it is built-in or managed by an integration.',
      roleTooHigh: '**{role}** is above the bot role — the bot cannot grant it.',
      pickTarget: 'Pick a channel or a role.',
      pickOne: 'Pick exactly one: a role or a channel.',
      ignored: 'No XP for: {targets}.',
      unignored: 'XP again for: {targets}.',
      multiplierSet: 'Multiplier for {target}: ×{value}.',
      multiplierRemoved: 'Multiplier for {target} removed.',
      publicSet: 'Public leaderboard: {state}.',
      reset: "**{user}**'s XP was reset.",
      nothingToReset: '**{user}** has no XP.',
    },
  },
};
