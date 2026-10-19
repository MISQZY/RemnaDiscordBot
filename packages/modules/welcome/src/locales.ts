import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    name: 'Приветствия',
    test: {
      sent: 'Тестовое сообщение отправлено.',
      notSent: 'Не удалось отправить: проверьте канал в настройках модуля и права бота. Для ЛС — открыты ли у вас личные сообщения.',
    },
  },
  en: {
    name: 'Welcome',
    test: {
      sent: 'Test message sent.',
      notSent: 'Could not send: check the channel in the module settings and the bot permissions. For DMs, make sure yours are open.',
    },
  },
};
