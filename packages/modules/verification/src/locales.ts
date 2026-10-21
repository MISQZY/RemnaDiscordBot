import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      verify: {
        description: 'Пропустить участника без проверки',
        options: { user: { name: 'участник', description: 'Участник' } },
      },
      verification: {
        description: 'Настроить верификацию',
        post: {
          name: 'post',
          description: 'Отправить сообщение верификации',
          options: { channel: { name: 'канал', description: 'Канал; по умолчанию из настроек' } },
        },
        roles: {
          name: 'roles',
          description: 'Роли верификации',
          options: {
            verified: { name: 'проверенный', description: 'Выдаётся после проверки' },
            unverified: { name: 'непроверенный', description: 'Выдаётся при входе, снимается после проверки' },
          },
        },
      },
    },
    name: 'Верификация',
    defaults: {
      message: 'Добро пожаловать на **{guild.name}**! Нажмите кнопку ниже, чтобы получить доступ к серверу.',
      button: 'Подтвердить',
    },
    notSetUp: 'Верификация ещё не настроена: нет ролей.',
    already: 'Вы уже прошли проверку.',
    passed: '✅ Проверка пройдена, добро пожаловать!',
    tooYoung: 'Ваш аккаунт слишком новый: нужно не меньше {days, plural, one {# дня} other {# дней}}.',
    locked: 'Слишком много ошибок. Попробуйте через 10 минут.',
    captcha: 'Нажмите на {emoji}',
    wrong: '❌ Не то. Попробуйте ещё раз.',
    expired: 'Время вышло — нажмите кнопку проверки ещё раз.',
    manual: '**{user}** пропущен без проверки.',
    rolesSet: 'Роль после проверки: {verified}. Роль до проверки: {unverified}.',
    noChannel: 'Укажите канал: /verification post канал.',
    posted: 'Сообщение верификации в {channel}.',
    log: {
      passed: '✅ {user} прошёл проверку.',
      failed: '❌ {user} трижды ошибся в капче.',
      tooYoung: '⚠️ {user} не прошёл: аккаунт слишком новый.',
    },
  },
  en: {
    commands: {
      verify: {
        description: 'Let a member in without the check',
        options: { user: { name: 'user', description: 'Member' } },
      },
      verification: {
        description: 'Set up verification',
        post: {
          name: 'post',
          description: 'Post the verification message',
          options: { channel: { name: 'channel', description: 'Channel; the one from the settings by default' } },
        },
        roles: {
          name: 'roles',
          description: 'Roles of verification',
          options: {
            verified: { name: 'verified', description: 'Given after passing' },
            unverified: { name: 'unverified', description: 'Given on join, taken away after passing' },
          },
        },
      },
    },
    name: 'Verification',
    defaults: {
      message: 'Welcome to **{guild.name}**! Press the button below to get access to the server.',
      button: 'Verify',
    },
    notSetUp: 'Verification is not set up yet: no roles.',
    already: 'You are verified already.',
    passed: '✅ Verified, welcome!',
    tooYoung: 'Your account is too new: it needs to be at least {days, plural, one {# day} other {# days}} old.',
    locked: 'Too many mistakes. Try again in 10 minutes.',
    captcha: 'Press {emoji}',
    wrong: '❌ Wrong one. Try again.',
    expired: 'Time is up — press the verification button again.',
    manual: '**{user}** was let in without the check.',
    rolesSet: 'Role after the check: {verified}. Role before it: {unverified}.',
    noChannel: 'Pick a channel: /verification post channel.',
    posted: 'The verification message is in {channel}.',
    log: {
      passed: '✅ {user} passed verification.',
      failed: '❌ {user} failed the captcha three times.',
      tooYoung: '⚠️ {user} did not pass: the account is too new.',
    },
  },
};
