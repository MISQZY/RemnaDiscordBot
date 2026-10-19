import { defineModule } from '@bot/core';
import { notificationsApi } from './api.js';
import { NotificationsConfig } from './config.js';
import { locales } from './locales.js';
import { pollProvider } from './poll.js';
import { providersFromEnv, type Provider, type ProviderId } from './providers.js';

export { NotificationsConfig, SubscriptionDto } from './config.js';
export { parseYoutubeFeed, TwitchProvider, YoutubeProvider, type Provider } from './providers.js';

let providers: Map<ProviderId, Provider> | undefined;
/** Провайдеры создаются лениво: модуль загружается и там, где сеть к ним не нужна. */
const getProviders = () => (providers ??= providersFromEnv());

const poll = (id: ProviderId) => async (ctx: Parameters<typeof pollProvider>[0]) => {
  const provider = getProviders().get(id);
  if (provider) await pollProvider(ctx, provider);
};

/** Оповещения о новых видео YouTube и стримах Twitch. Источники опрашивает воркер. */
export default defineModule({
  id: 'notifications',
  configSchema: NotificationsConfig,
  defaultConfig: {},
  configVersion: 1,
  locales,
  intervals: {
    youtube: { everyMs: 5 * 60_000, run: poll('youtube') },
    twitch: { everyMs: 2 * 60_000, run: poll('twitch') },
  },
  api: notificationsApi(getProviders),
});
