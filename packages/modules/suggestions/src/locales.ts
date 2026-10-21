import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      suggest: { description: 'Предложить идею для сервера', options: { text: { name: 'текст', description: 'Ваше предложение' } } },
      suggestion: {
        description: 'Решение по предложению',
        options: {
          number: { name: 'номер', description: 'Номер предложения' },
          status: {
            name: 'решение',
            description: 'Решение',
            choices: { pending: 'На рассмотрении', considered: 'Обдумываем', approved: 'Принято', denied: 'Отклонено', implemented: 'Сделано' },
          },
          response: { name: 'ответ', description: 'Ответ автору' },
        },
      },
    },
    name: 'Предложения',
    statuses: { pending: 'На рассмотрении', considered: '🤔 Обдумываем', approved: '✅ Принято', denied: '❌ Отклонено', implemented: '🚀 Сделано' },
    embed: { title: 'Предложение #{number}', author: 'Автор', status: 'Статус', reviewer: 'Решение принял', response: 'Ответ' },
    thread: 'Обсуждение #{number}',
    off: 'Предложения на этом сервере выключены.',
    sent: 'Предложение #{number} отправлено в {channel}.',
    noAccess: 'Решения принимают управляющие сервером и роли из настроек.',
    notFound: 'Предложение не найдено.',
    decided: 'Предложение #{number}: {status}.',
    closed: 'Голосование по этому предложению закрыто.',
    dm: 'Ваше предложение #{number}: {status}. Ответ: {response}',
  },
  en: {
    commands: {
      suggest: { description: 'Suggest something for the server', options: { text: { name: 'text', description: 'Your suggestion' } } },
      suggestion: {
        description: 'Decide on a suggestion',
        options: {
          number: { name: 'number', description: 'Suggestion number' },
          status: {
            name: 'status',
            description: 'Decision',
            choices: { pending: 'Pending', considered: 'Considering', approved: 'Approved', denied: 'Denied', implemented: 'Implemented' },
          },
          response: { name: 'response', description: 'Answer to the author' },
        },
      },
    },
    name: 'Suggestions',
    statuses: { pending: 'Pending', considered: '🤔 Considering', approved: '✅ Approved', denied: '❌ Denied', implemented: '🚀 Implemented' },
    embed: { title: 'Suggestion #{number}', author: 'Author', status: 'Status', reviewer: 'Decided by', response: 'Response' },
    thread: 'Discussion #{number}',
    off: 'Suggestions are off on this server.',
    sent: 'Suggestion #{number} was posted in {channel}.',
    noAccess: 'Decisions are made by server managers and the roles from the settings.',
    notFound: 'Suggestion not found.',
    decided: 'Suggestion #{number}: {status}.',
    closed: 'Voting on this suggestion is closed.',
    dm: 'Your suggestion #{number}: {status}. Response: {response}',
  },
};
