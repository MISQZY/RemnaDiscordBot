import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      invites: {
        description: 'Приглашения',
        show: { name: 'show', description: 'Сколько участников пригласил', options: { user: { name: 'участник', description: 'Участник; по умолчанию вы' } } },
        top: { name: 'top', description: 'Кто пригласил больше всех' },
      },
    },
    name: 'Приглашения',
    counts: '{user}: **{total}** · пришло {joins}, ушло {left}, фейковых {fake}',
    topTitle: 'Больше всех пригласили',
    topLine: '**{place}.** {user} — {count}',
    noneYet: 'Пока никто никого не пригласил.',
    log: {
      joined: '📥 {user} зашёл по приглашению {inviter} (`{code}`, у него теперь {count})',
      vanity: '📥 {user} зашёл по ссылке сервера',
      unknown: '📥 {user} зашёл; приглашение не определить',
    },
  },
  en: {
    commands: {
      invites: {
        description: 'Invites',
        show: { name: 'show', description: 'How many members someone invited', options: { user: { name: 'user', description: 'Member; you by default' } } },
        top: { name: 'top', description: 'Who invited the most' },
      },
    },
    name: 'Invites',
    counts: '{user}: **{total}** · joined {joins}, left {left}, fake {fake}',
    topTitle: 'Top inviters',
    topLine: '**{place}.** {user} — {count}',
    noneYet: 'Nobody has invited anyone yet.',
    log: {
      joined: '📥 {user} joined by the invite of {inviter} (`{code}`, now {count})',
      vanity: '📥 {user} joined by the server link',
      unknown: '📥 {user} joined; the invite could not be told',
    },
  },
};
