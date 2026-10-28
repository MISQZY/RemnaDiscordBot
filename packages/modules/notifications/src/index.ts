import { defineModule } from '@bot/core';
import { notificationsApi } from './api.js';
import { notifyCommand } from './commands.js';
import { NotificationsConfig } from './config.js';
import { locales } from './locales.js';
import { pollProvider } from './poll.js';
import { providersFromEnv, type Provider, type ProviderId } from './providers.js';

export { DeliveryError, NotificationsConfig, SourceError, SubscriptionDto, SubscriptionFilter } from './config.js';
export { parseFeed } from './feed.js';
export { FeedProvider, parseYoutubeFeed, SourceFailure, TwitchProvider, YoutubeProvider, type FeedResult, type Provider } from './providers.js';
export { createSafeFetch, isPublicAddress } from './safe-fetch.js';

let providers: Map<ProviderId, Provider> | undefined;
/** Providers are created lazily: the module also loads where their network is not needed. */
const getProviders = () => (providers ??= providersFromEnv());

const poll = (id: ProviderId) => async (ctx: Parameters<typeof pollProvider>[0]) => {
  const provider = getProviders().get(id);
  if (provider) await pollProvider(ctx, provider);
};

/** Notifications about new YouTube videos, Twitch streams and posts in RSS, Atom and JSON feeds. The worker polls the sources. */
export default defineModule({
  id: 'notifications',
  configSchema: NotificationsConfig,
  defaultConfig: {},
  configVersion: 1,
  locales,
  bot: { commands: [notifyCommand(getProviders)] },
  intervals: {
    youtube: { everyMs: 5 * 60_000, run: poll('youtube') },
    twitch: { everyMs: 2 * 60_000, run: poll('twitch') },
    feed: { everyMs: 10 * 60_000, run: poll('feed') },
  },
  api: notificationsApi(getProviders),
});
