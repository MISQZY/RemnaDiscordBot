import type { VipFeature } from '@bot/contracts';
import { eachLimit, HttpError } from '@bot/core';
import type { SourceError } from './config.js';
import { discoverFeed, parseFeed, type ParsedFeed } from './feed.js';
import { createSafeFetch, FetchRefused, type FetchText } from './safe-fetch.js';

export type Fetch = typeof fetch;
export type ProviderId = 'youtube' | 'twitch' | 'feed' | 'api';

export interface SourceInfo {
  externalId: string;
  name: string;
  url: string;
}

/** A new video, a started stream or a post. `id` is used for deduplication. */
export interface FeedItem {
  id: string;
  vars: Record<string, string | number>;
  /** What subscription filters search: the title and the description. */
  text?: string;
}

/** Why a source could not be checked; the message is for the logs. */
export class SourceFailure extends Error {
  constructor(
    readonly kind: SourceError,
    message: string,
  ) {
    super(message);
  }
}

/** A source's items from newest to oldest, or why they could not be fetched this time. */
export type FeedResult = FeedItem[] | SourceFailure;

export interface Provider {
  id: ProviderId;
  /** Works only in guilds with VIP when the dashboard says this feature needs it. */
  vipFeature?: VipFeature;
  /** A channel or streamer by link, ID or name. */
  lookup(query: string): Promise<SourceInfo>;
  /** Each source's result, keyed by externalId; a failing source does not hold up the rest. `settings` — the sources' own. */
  latest(externalIds: string[], settings?: Map<string, unknown>): Promise<Map<string, FeedResult>>;
}

const decode = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const tag = (xml: string, name: string) => {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decode(match[1]!.trim()) : '';
};

/** YouTube Atom feed: the format is stable, so no XML parser is needed. */
export function parseYoutubeFeed(xml: string): { channelName: string; items: FeedItem[] } {
  const channelName = tag(xml.split('<entry>')[0] ?? '', 'title');
  const items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const videoId = tag(entry!, 'yt:videoId');
    return {
      id: videoId,
      vars: {
        'video.id': videoId,
        'video.title': tag(entry!, 'title'),
        'video.url': `https://www.youtube.com/watch?v=${videoId}`,
        'channel.name': tag(entry!, 'name') || channelName,
      },
      text: tag(entry!, 'title'),
    };
  });
  return { channelName, items };
}

const YOUTUBE_CHANNEL_ID = /^UC[\w-]{22}$/;
/** Feeds fetched at once, and how long one may take: a hanging feed must not hold up the rest. */
const FEED_CONCURRENCY = 5;
const FEED_TIMEOUT_MS = 10_000;

export class YoutubeProvider implements Provider {
  readonly id = 'youtube' as const;

  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async lookup(query: string): Promise<SourceInfo> {
    const channelId = YOUTUBE_CHANNEL_ID.test(query) ? query : await this.resolveChannelId(query);
    const { channelName } = parseYoutubeFeed(await this.feed(channelId));
    return { externalId: channelId, name: channelName || channelId, url: `https://www.youtube.com/channel/${channelId}` };
  }

  /** The channels' feeds, a few at a time; a channel whose feed fails fails alone. */
  async latest(externalIds: string[]): Promise<Map<string, FeedResult>> {
    const result = new Map<string, FeedResult>();
    await eachLimit(externalIds, FEED_CONCURRENCY, async (id) => {
      try {
        result.set(id, parseYoutubeFeed(await this.feed(id)).items);
      } catch (err) {
        // The feed answers 404 for a deleted channel; anything else is an outage.
        const kind = err instanceof HttpError && err.statusCode === 400 ? 'notFound' : 'unavailable';
        result.set(id, new SourceFailure(kind, err instanceof Error ? err.message : String(err)));
      }
    });
    return result;
  }

  private async feed(channelId: string): Promise<string> {
    const response = await this.fetchImpl(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (response.status === 404) throw HttpError.badRequest('YouTube channel not found');
    if (!response.ok) throw new Error(`YouTube feed responded with ${response.status}`);
    return response.text();
  }

  /** A /channel/UC… or /@handle link, or just @handle → the channel ID from the page. */
  private async resolveChannelId(query: string): Promise<string> {
    const fromUrl = /channel\/(UC[\w-]{22})/.exec(query)?.[1];
    if (fromUrl) return fromUrl;
    const handle = /@([\w.-]+)/.exec(query)?.[1] ?? query.replace(/^.*youtube\.com\//, '');
    const response = await this.fetchImpl(`https://www.youtube.com/@${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    const html = response.ok ? await response.text() : '';
    const channelId = /"(?:channelId|externalId)":"(UC[\w-]{22})"/.exec(html)?.[1];
    if (!channelId) throw HttpError.badRequest('YouTube channel not found');
    return channelId;
  }
}

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
}

interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  game_name: string;
  viewer_count: number;
}

export class TwitchProvider implements Provider {
  readonly id = 'twitch' as const;
  private token: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async lookup(query: string): Promise<SourceInfo> {
    const login = (/twitch\.tv\/([\w]+)/.exec(query)?.[1] ?? query).toLowerCase();
    const { data } = await this.helix<{ data: TwitchUser[] }>(`/users?login=${encodeURIComponent(login)}`);
    const user = data[0];
    if (!user) throw HttpError.badRequest('Twitch user not found');
    return { externalId: user.id, name: user.display_name, url: `https://www.twitch.tv/${user.login}` };
  }

  async latest(externalIds: string[]): Promise<Map<string, FeedResult>> {
    const result = new Map<string, FeedResult>(externalIds.map((id) => [id, []]));
    // Helix accepts up to 100 users per request.
    for (let i = 0; i < externalIds.length; i += 100) {
      const batch = externalIds.slice(i, i + 100);
      let data: TwitchStream[];
      try {
        ({ data } = await this.helix<{ data: TwitchStream[] }>(`/streams?${batch.map((id) => `user_id=${id}`).join('&')}`));
      } catch (err) {
        const failure = new SourceFailure('unavailable', err instanceof Error ? err.message : String(err));
        for (const id of batch) result.set(id, failure);
        continue;
      }
      for (const stream of data) {
        result.set(stream.user_id, [
          {
            id: stream.id,
            vars: {
              'stream.title': stream.title,
              'stream.game': stream.game_name,
              'stream.viewers': stream.viewer_count,
              'stream.url': `https://www.twitch.tv/${stream.user_login}`,
              'channel.name': stream.user_name,
            },
            text: `${stream.title}
${stream.game_name}`,
          },
        ]);
      }
    }
    return result;
  }

  private async helix<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`https://api.twitch.tv/helix${path}`, {
      headers: { 'client-id': this.clientId, authorization: `Bearer ${await this.appToken()}` },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (response.status === 401) this.token = undefined;
    if (!response.ok) throw new Error(`Twitch API responded with ${response.status}`);
    return (await response.json()) as T;
  }

  private async appToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'client_credentials' });
    const response = await this.fetchImpl('https://id.twitch.tv/oauth2/token', { method: 'POST', body, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Twitch token request failed with ${response.status}`);
    const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A link typed without a scheme is taken as https. */
export function feedUrl(query: string): URL {
  const trimmed = query.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][\w+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw HttpError.badRequest('Not a valid link');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw HttpError.badRequest('Only http and https links are supported');
  url.hash = '';
  return url;
}

interface Cached {
  etag?: string;
  lastModified?: string;
  items: FeedItem[];
}

/**
 * Any RSS, Atom or JSON Feed by its address, or by a page that links to one. Feeds come from addresses users type
 * in, so they are fetched through `createSafeFetch`: public addresses only, a bounded body.
 */
export class FeedProvider implements Provider {
  readonly id = 'feed' as const;
  /** The last items of each feed with its validators, to ask "changed since?" and get a 304 instead of the feed. */
  private readonly cache = new Map<string, Cached>();

  constructor(private readonly fetchText: FetchText = createSafeFetch({ timeoutMs: FEED_TIMEOUT_MS })) {}

  async lookup(query: string): Promise<SourceInfo> {
    let response;
    try {
      response = await this.fetchText(feedUrl(query).toString());
      let feed = response.status === 200 ? parseFeed(response.body, response.url) : null;
      // A site's page: follow the feed it points to.
      const discovered = !feed && response.status === 200 ? discoverFeed(response.body, response.url) : null;
      if (discovered) {
        response = await this.fetchText(discovered);
        feed = response.status === 200 ? parseFeed(response.body, response.url) : null;
      }
      if (response.status !== 200) throw HttpError.badRequest(`The address responded with ${response.status}`);
      if (!feed) throw HttpError.badRequest('No RSS, Atom or JSON feed at this address');
      return { externalId: response.url, name: feed.title || new URL(response.url).hostname, url: feed.link ?? response.url };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw HttpError.badRequest(`Could not load the feed: ${message(err)}`);
    }
  }

  async latest(externalIds: string[]): Promise<Map<string, FeedResult>> {
    const result = new Map<string, FeedResult>();
    await eachLimit(externalIds, FEED_CONCURRENCY, async (url) => {
      result.set(url, await this.check(url));
    });
    // Feeds no longer checked are forgotten.
    for (const url of this.cache.keys()) if (!externalIds.includes(url)) this.cache.delete(url);
    return result;
  }

  private async check(url: string): Promise<FeedResult> {
    const cached = this.cache.get(url);
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
    let response;
    try {
      response = await this.fetchText(url, headers);
    } catch (err) {
      // A refused address or body will not get better by itself; a network error might.
      return new SourceFailure(err instanceof FetchRefused ? 'invalid' : 'unavailable', message(err));
    }
    if (response.status === 304 && cached) return cached.items;
    if (response.status === 404 || response.status === 410) return new SourceFailure('notFound', `The feed responded with ${response.status}`);
    if (response.status !== 200) return new SourceFailure('unavailable', `The feed responded with ${response.status}`);
    const feed: ParsedFeed | null = parseFeed(response.body, response.url);
    if (!feed) return new SourceFailure('invalid', 'The address no longer serves a feed');
    this.cache.set(url, { etag: response.headers.etag, lastModified: response.headers['last-modified'], items: feed.items });
    return feed.items;
  }
}

/** Providers from the process environment: Twitch only when the app credentials are set. */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): Map<ProviderId, Provider> {
  const providers = new Map<ProviderId, Provider>([
    ['youtube', new YoutubeProvider()],
    ['feed', new FeedProvider()],
  ]);
  if (env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET) {
    providers.set('twitch', new TwitchProvider(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET));
  }
  return providers;
}
