import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
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
