import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    name: 'Приветствия',
    defaults: {
      join: 'Добро пожаловать на **{guild.name}**, {user.mention}! Ты наш {guild.memberCount}-й участник.',
      dm: 'Привет, {user.displayName}! Рады видеть тебя на **{guild.name}**.',
      leave: '**{user.name}** покинул сервер.',
    },
    test: {
      sent: 'Тестовое сообщение отправлено.',
      notSent: 'Не удалось отправить: проверьте канал в настройках модуля и права бота. Для ЛС — открыты ли у вас личные сообщения.',
    },
  },
  en: {
    name: 'Welcome',
    defaults: {
      join: 'Welcome to **{guild.name}**, {user.mention}! You are member #{guild.memberCount}.',
      dm: 'Hi {user.displayName}! Glad to see you on **{guild.name}**.',
      leave: '**{user.name}** left the server.',
    },
    test: {
      sent: 'Test message sent.',
      notSent: 'Could not send: check the channel in the module settings and the bot permissions. For DMs, make sure yours are open.',
    },
  },
};
