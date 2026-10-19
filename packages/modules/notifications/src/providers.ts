import { HttpError } from '@bot/core';

export type Fetch = typeof fetch;
export type ProviderId = 'youtube' | 'twitch';

export interface SourceInfo {
  externalId: string;
  name: string;
  url: string;
}

/** A new video or a started stream. `id` is used for deduplication. */
export interface FeedItem {
  id: string;
  vars: Record<string, string | number>;
}

export interface Provider {
  id: ProviderId;
  /** A channel or streamer by link, ID or name. */
  lookup(query: string): Promise<SourceInfo>;
  /** Sources' items from newest to oldest; keyed by externalId. */
  latest(externalIds: string[]): Promise<Map<string, FeedItem[]>>;
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
    };
  });
  return { channelName, items };
}

const YOUTUBE_CHANNEL_ID = /^UC[\w-]{22}$/;

export class YoutubeProvider implements Provider {
  readonly id = 'youtube' as const;

  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async lookup(query: string): Promise<SourceInfo> {
    const channelId = YOUTUBE_CHANNEL_ID.test(query) ? query : await this.resolveChannelId(query);
    const { channelName } = parseYoutubeFeed(await this.feed(channelId));
    return { externalId: channelId, name: channelName || channelId, url: `https://www.youtube.com/channel/${channelId}` };
  }

  async latest(externalIds: string[]): Promise<Map<string, FeedItem[]>> {
    const result = new Map<string, FeedItem[]>();
    for (const id of externalIds) {
      result.set(id, parseYoutubeFeed(await this.feed(id)).items);
    }
    return result;
  }

  private async feed(channelId: string): Promise<string> {
    const response = await this.fetchImpl(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (response.status === 404) throw HttpError.badRequest('YouTube channel not found');
    if (!response.ok) throw new Error(`YouTube feed responded with ${response.status}`);
    return response.text();
  }

  /** A /channel/UC… or /@handle link, or just @handle → the channel ID from the page. */
  private async resolveChannelId(query: string): Promise<string> {
    const fromUrl = /channel\/(UC[\w-]{22})/.exec(query)?.[1];
    if (fromUrl) return fromUrl;
    const handle = /@([\w.-]+)/.exec(query)?.[1] ?? query.replace(/^.*youtube\.com\//, '');
    const response = await this.fetchImpl(`https://www.youtube.com/@${encodeURIComponent(handle)}`);
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

  async latest(externalIds: string[]): Promise<Map<string, FeedItem[]>> {
    const result = new Map<string, FeedItem[]>(externalIds.map((id) => [id, []]));
    // Helix accepts up to 100 users per request.
    for (let i = 0; i < externalIds.length; i += 100) {
      const query = externalIds.slice(i, i + 100).map((id) => `user_id=${id}`).join('&');
      const { data } = await this.helix<{ data: TwitchStream[] }>(`/streams?${query}`);
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
          },
        ]);
      }
    }
    return result;
  }

  private async helix<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`https://api.twitch.tv/helix${path}`, {
      headers: { 'client-id': this.clientId, authorization: `Bearer ${await this.appToken()}` },
    });
    if (response.status === 401) this.token = undefined;
    if (!response.ok) throw new Error(`Twitch API responded with ${response.status}`);
    return (await response.json()) as T;
  }

  private async appToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'client_credentials' });
    const response = await this.fetchImpl('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
    if (!response.ok) throw new Error(`Twitch token request failed with ${response.status}`);
    const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }
}

/** Providers from the process environment: Twitch only when the app credentials are set. */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): Map<ProviderId, Provider> {
  const providers = new Map<ProviderId, Provider>([['youtube', new YoutubeProvider()]]);
  if (env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET) {
    providers.set('twitch', new TwitchProvider(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET));
  }
  return providers;
}
