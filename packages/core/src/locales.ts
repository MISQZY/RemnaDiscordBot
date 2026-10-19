import type { Locale } from '@bot/contracts';
import type { Dictionary, I18n } from '@bot/i18n';

/** Неймспейс системных сообщений; модуль с таким id зарегистрировать нельзя. */
export const CORE_NAMESPACE = 'core';

export const coreLocales: Record<Locale, Dictionary> = {
  ru: {
    moduleDisabled: 'Модуль «{module}» отключён на этом сервере.',
    cooldown: 'Подождите {seconds} с перед повторным использованием.',
    error: 'Что-то пошло не так. Попробуйте позже.',
  },
  en: {
    moduleDisabled: 'The “{module}” module is disabled on this server.',
    cooldown: 'Please wait {seconds}s before using this again.',
    error: 'Something went wrong. Please try again later.',
  },
};

export function registerCoreLocales(i18n: I18n): void {
  i18n.register(CORE_NAMESPACE, coreLocales);
}
