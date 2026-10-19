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
  },
};
