import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      remind: {
        description: 'Напоминания',
        me: {
          name: 'me',
          description: 'Напомнить мне позже',
          options: {
            in: { name: 'через', description: 'Когда: 10м, 2ч, 1д…' },
            text: { name: 'текст', description: 'О чём напомнить' },
            dm: { name: 'в_лс', description: 'Напомнить в личных сообщениях' },
          },
        },
        list: { name: 'list', description: 'Мои напоминания' },
        delete: { name: 'delete', description: 'Удалить напоминание', options: { id: { name: 'напоминание', description: 'Из списка' } } },
      },
      sticky: {
        description: 'Сообщение, которое всегда внизу канала',
        set: {
          name: 'set',
          description: 'Держать этот текст внизу канала',
          options: { text: { name: 'текст', description: 'Текст' }, channel: { name: 'канал', description: 'Канал; по умолчанию текущий' } },
        },
        remove: { name: 'remove', description: 'Больше не держать сообщение', options: { channel: { name: 'канал', description: 'Канал; по умолчанию текущий' } } },
      },
    },
    name: 'Сообщения',
    remind: {
      off: 'Напоминания на этом сервере выключены.',
      none: 'У вас нет напоминаний.',
      deleted: 'Напоминание удалено.',
      notFound: 'Такого напоминания нет.',
      badTime: 'Укажите срок от минуты до года, например 30м, 2ч, 3д.',
      limit: 'Не больше {max} напоминаний на участника.',
      set: 'Напомню через {in} — {time}.',
      due: '⏰ {user}, напоминание ({when}): {text}',
    },
    sticky: {
      none: 'В этом канале нет закреплённого внизу сообщения.',
      removed: 'Сообщение в {channel} больше не держится внизу.',
      set: 'Сообщение будет внизу {channel}.',
      noAccess: 'Чтобы закрепить сообщение в {channel}, нужно право управлять сообщениями и писать в этом канале.',
    },
  },
  en: {
    commands: {
      remind: {
        description: 'Reminders',
        me: {
          name: 'me',
          description: 'Remind me later',
          options: {
            in: { name: 'in', description: 'When: 10m, 2h, 1d…' },
            text: { name: 'text', description: 'What to remind about' },
            dm: { name: 'dm', description: 'Remind in DMs' },
          },
        },
        list: { name: 'list', description: 'My reminders' },
        delete: { name: 'delete', description: 'Delete a reminder', options: { id: { name: 'id', description: 'Reminder from the list' } } },
      },
      sticky: {
        description: 'A message kept at the bottom of the channel',
        set: {
          name: 'set',
          description: 'Keep this text at the bottom of the channel',
          options: { text: { name: 'text', description: 'Text' }, channel: { name: 'channel', description: 'Channel; the current one by default' } },
        },
        remove: { name: 'remove', description: 'Stop keeping the message', options: { channel: { name: 'channel', description: 'Channel; the current one by default' } } },
      },
    },
    name: 'Messages',
    remind: {
      off: 'Reminders are off on this server.',
      none: 'You have no reminders.',
      deleted: 'Reminder deleted.',
      notFound: 'There is no such reminder.',
      badTime: 'Give a time from a minute to a year, e.g. 30m, 2h, 3d.',
      limit: 'At most {max} reminders per member.',
      set: 'I will remind you in {in} — {time}.',
      due: '⏰ {user}, a reminder ({when}): {text}',
    },
    sticky: {
      none: 'This channel has no sticky message.',
      removed: 'The message in {channel} is no longer kept at the bottom.',
      set: 'The message will stay at the bottom of {channel}.',
      noAccess: 'To keep a message in {channel}, you need to manage messages and write in that channel.',
    },
  },
};
