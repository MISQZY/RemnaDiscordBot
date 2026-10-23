import type { Locale } from '@bot/contracts';
import type { Dictionary, I18n } from '@bot/i18n';

/** Неймспейс системных сообщений; модуль с таким id зарегистрировать нельзя. */
export const CORE_NAMESPACE = 'core';

export const coreLocales: Record<Locale, Dictionary> = {
  ru: {
    moduleDisabled: 'Модуль «{module}» отключён на этом сервере. Администратор может включить его: /modules enable {id}',
    vipRequired: 'Модуль «{module}» работает только на серверах с VIP. Активируйте VIP-ключ в панели управления.',
    cooldown: 'Подождите {seconds} с перед повторным использованием.',
    error: 'Что-то пошло не так. Попробуйте позже.',
    roleElevated: 'Роль «{role}» даёт модераторские права — бот такие роли не выдаёт.',
    roleAboveYou: 'Роль «{role}» не ниже вашей высшей роли — выбрать её может только тот, кто выше.',
  },
  en: {
    moduleDisabled: 'The “{module}” module is disabled on this server. An admin can enable it with /modules enable {id}',
    vipRequired: 'The “{module}” module works only on servers with VIP. Activate a VIP key in the dashboard.',
    cooldown: 'Please wait {seconds}s before using this again.',
    error: 'Something went wrong. Please try again later.',
    roleElevated: 'The “{role}” role grants moderator permissions — the bot does not hand such roles out.',
    roleAboveYou: 'The “{role}” role is not below your highest role — only someone above it can pick it.',
  },
};

export function registerCoreLocales(i18n: I18n): void {
  i18n.register(CORE_NAMESPACE, coreLocales);
}
