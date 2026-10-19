import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    name: 'Оповещения',
    defaults: {
      youtube: '📺 **{channel.name}** выпустил новое видео: **{video.title}**\n{video.url}',
      twitch: '🔴 **{channel.name}** в эфире: **{stream.title}** ({stream.game})\n{stream.url}',
    },
  },
  en: {
    name: 'Notifications',
    defaults: {
      youtube: '📺 **{channel.name}** posted a new video: **{video.title}**\n{video.url}',
      twitch: '🔴 **{channel.name}** is live: **{stream.title}** ({stream.game})\n{stream.url}',
    },
  },
};
