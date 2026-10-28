import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      notify: {
        description: 'Оповещения о YouTube, Twitch и RSS',
        list: { name: 'list', description: 'Показать подписки' },
        add: {
          name: 'add',
          description: 'Оповещать о новых видео, стримах или записях',
          options: {
            platform: { name: 'площадка', description: 'Где следить', choices: { youtube: 'YouTube', twitch: 'Twitch', feed: 'RSS / Atom' } },
            source: { name: 'источник', description: 'Ссылка на канал, @handle, логин Twitch или ссылка на ленту или сайт' },
            channel: { name: 'канал', description: 'Куда писать' },
            role: { name: 'роль', description: 'Какую роль упоминать' },
            message: { name: 'текст', description: 'Текст: {channel.name}, {video.url}, {stream.url}, {item.url}…' },
          },
        },
        edit: {
          name: 'edit',
          description: 'Изменить подписку',
          options: {
            subscription: { name: 'подписка', description: 'Подписка' },
            channel: { name: 'канал', description: 'Куда писать' },
            role: { name: 'роль', description: 'Какую роль упоминать' },
            'no-mention': { name: 'без-упоминания', description: 'Никого не упоминать' },
            message: { name: 'текст', description: 'Новый текст' },
            enabled: { name: 'включена', description: 'Включена' },
          },
        },
        remove: { name: 'remove', description: 'Отписаться', options: { subscription: { name: 'подписка', description: 'Подписка' } } },
      },
    },
    name: 'Оповещения',
    defaults: {
      youtube: '📺 **{channel.name}** выпустил новое видео: **{video.title}**\n{video.url}',
      twitch: '🔴 **{channel.name}** в эфире: **{stream.title}** ({stream.game})\n{stream.url}',
      feed: '📰 **{feed.name}**: **{item.title}**\n{item.url}',
      webhook: '📣 **{hook.name}**: {body.text}',
      api: '🔔 {item.title} {item.url}',
    },
    manage: {
      empty: 'Подписок пока нет — добавьте через `/notify add`.',
      footer: '{count} из {max}',
      noAccess: 'Бот не может писать в {channel}: нужны права «Просмотр канала», «Отправка сообщений» и «Встраивать ссылки».',
      added: 'Подписка на {source} добавлена — оповещения будут в {channel}.',
      updated: 'Подписка на {source} изменена.',
      removed: 'Подписка на **{source}** удалена.',
      sourceErrors: {
        notFound: 'канал не найден — возможно, он удалён',
        unavailable: 'площадка не отвечает, проверки идут реже',
        invalid: 'по адресу больше нет ленты или её не прочитать',
        denied: 'API отказывает в доступе — проверьте ключ',
      },
      deliveryErrors: {
        noAccess: 'последнее оповещение не отправлено: у бота нет прав в канале',
        channelNotFound: 'последнее оповещение не отправлено: канала больше нет',
        failed: 'последнее оповещение не отправлено',
      },
      errors: {
        limit: 'На сервере уже {max} подписок — это максимум.',
        conflict: 'Сервер уже подписан на этот источник.',
        references: 'Канал или роль не найдены на сервере.',
        notConfigured: 'Эта площадка не настроена у бота.',
        notFound: 'Подписка не найдена.',
        sourceNotFound: 'Канал или стример не найден — проверьте ссылку или имя.',
        feedNotFound: 'По этой ссылке нет ленты RSS, Atom или JSON Feed, и страница на неё не ссылается.',
        vipRequired: 'Опрос API работает только на серверах с VIP.',
      },
    },
  },
  en: {
    commands: {
      notify: {
        description: 'YouTube, Twitch and RSS notifications',
        list: { name: 'list', description: 'Show subscriptions' },
        add: {
          name: 'add',
          description: 'Notify about new videos, streams or posts',
          options: {
            platform: { name: 'platform', description: 'Where to watch', choices: { youtube: 'YouTube', twitch: 'Twitch', feed: 'RSS / Atom' } },
            source: { name: 'source', description: 'Channel link, @handle, Twitch login or a feed or site link' },
            channel: { name: 'channel', description: 'Where to post' },
            role: { name: 'role', description: 'Role to mention' },
            message: { name: 'message', description: 'Text: {channel.name}, {video.url}, {stream.url}, {item.url}…' },
          },
        },
        edit: {
          name: 'edit',
          description: 'Change a subscription',
          options: {
            subscription: { name: 'subscription', description: 'Subscription' },
            channel: { name: 'channel', description: 'Where to post' },
            role: { name: 'role', description: 'Role to mention' },
            'no-mention': { name: 'no-mention', description: 'Mention nobody' },
            message: { name: 'message', description: 'New text' },
            enabled: { name: 'enabled', description: 'Enabled' },
          },
        },
        remove: { name: 'remove', description: 'Unsubscribe', options: { subscription: { name: 'subscription', description: 'Subscription' } } },
      },
    },
    name: 'Notifications',
    defaults: {
      youtube: '📺 **{channel.name}** posted a new video: **{video.title}**\n{video.url}',
      twitch: '🔴 **{channel.name}** is live: **{stream.title}** ({stream.game})\n{stream.url}',
      feed: '📰 **{feed.name}**: **{item.title}**\n{item.url}',
      webhook: '📣 **{hook.name}**: {body.text}',
      api: '🔔 {item.title} {item.url}',
    },
    manage: {
      empty: 'No subscriptions yet — add one with `/notify add`.',
      footer: '{count} of {max}',
      noAccess: 'The bot cannot post in {channel}: it needs View Channel, Send Messages and Embed Links.',
      added: 'Subscribed to {source} — notifications go to {channel}.',
      updated: 'Subscription to {source} updated.',
      removed: 'Unsubscribed from **{source}**.',
      sourceErrors: {
        notFound: 'channel not found — it may have been deleted',
        unavailable: 'the platform is not responding, checking less often',
        invalid: 'the address no longer serves a readable feed',
        denied: 'the API refuses access — check the key',
      },
      deliveryErrors: {
        noAccess: 'the last notification was not posted: the bot lacks permissions in the channel',
        channelNotFound: 'the last notification was not posted: the channel is gone',
        failed: 'the last notification was not posted',
      },
      errors: {
        limit: 'This server already has {max} subscriptions — the maximum.',
        conflict: 'This server is already subscribed to this source.',
        references: 'The channel or role was not found on the server.',
        notConfigured: 'This platform is not set up for the bot.',
        notFound: 'Subscription not found.',
        sourceNotFound: 'Channel or streamer not found — check the link or the name.',
        feedNotFound: 'There is no RSS, Atom or JSON feed at this link, and the page does not point to one.',
        vipRequired: 'API polling works only on servers with VIP.',
      },
    },
  },
};
