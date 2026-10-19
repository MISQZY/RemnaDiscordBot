import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    name: 'Автороли',
    added: 'Выданы роли: {roles}',
    removed: 'Сняты роли: {roles}',
    unchanged: 'Роли не изменились.',
    limit: 'Можно выбрать не больше {max, plural, one {# роли} other {# ролей}} из этой панели.',
    cannotManage: 'Часть ролей бот выдать не может — сообщите администратору.',
    panelMissing: 'Эта панель ролей больше не существует.',
  },
  en: {
    name: 'Autoroles',
    added: 'Roles added: {roles}',
    removed: 'Roles removed: {roles}',
    unchanged: 'Your roles did not change.',
    limit: 'You can pick at most {max, plural, one {# role} other {# roles}} from this panel.',
    cannotManage: 'The bot cannot manage some of these roles — please tell an administrator.',
    panelMissing: 'This role panel no longer exists.',
  },
};
