import { describe, expect, it, vi } from 'vitest';
import { announcementBody, backoffMs, freshItems, rememberItems } from './poll.js';
import { channelPageUrl, parseYoutubeFeed, SourceFailure, TwitchProvider, YoutubeProvider, type Fetch, type FeedItem } from './providers.js';

const CHANNEL_ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <title>Google &amp; Friends</title>
  <entry>
    <yt:videoId>new123</yt:videoId>
    <title>Second &quot;video&quot;</title>
    <author><name>Google &amp; Friends</name></author>
  </entry>
  <entry>
    <yt:videoId>old456</yt:videoId>
    <title>First video</title>
    <author><name>Google &amp; Friends</name></author>
  </entry>
</feed>`;

const response = (body: string | object, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('parseYoutubeFeed', () => {
  it('extracts videos newest first with decoded titles', () => {
    const { channelName, items } = parseYoutubeFeed(feed);

    expect(channelName).toBe('Google & Friends');
    expect(items.map((i) => i.id)).toEqual(['new123', 'old456']);
    expect(items[0]!.vars).toEqual({
      'video.id': 'new123',
      'video.title': 'Second "video"',
      'video.url': 'https://www.youtube.com/watch?v=new123',
      'video.published': '',
      'channel.name': 'Google & Friends',
    });
  });
});

describe('YoutubeProvider', () => {
  // A channel page lists other channels too, and one of them may come first (as on @thefaser's).
  const page = `<html><head><title>Google &amp; Friends - YouTube</title><meta property="og:title" content="Google &amp; Friends">
    <link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}"></head>
    <body>{"channelId":"UCmf8kCHCiuX8lWzLRoUq-Bw","externalId":"${CHANNEL_ID}"}</body></html>`;

  it('looks up channels by ID, link or @handle, taking the page own ID and name', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => (String(url).includes('/feeds/') ? response('', 404) : response(page))) as unknown as Fetch;
    const provider = new YoutubeProvider(fetchImpl);

    for (const query of [CHANNEL_ID, '@google', 'google', 'https://www.youtube.com/@google/videos', `https://youtube.com/channel/${CHANNEL_ID}`]) {
      expect(await provider.lookup(query), query).toEqual({ externalId: CHANNEL_ID, name: 'Google & Friends', url: `https://www.youtube.com/channel/${CHANNEL_ID}` });
    }
    // The feed is not needed, and it was down.
    expect(vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/feeds/'))).toEqual([]);
  });

  it('finds the page of every kind of link', () => {
    expect(channelPageUrl(CHANNEL_ID)).toBe(`https://www.youtube.com/channel/${CHANNEL_ID}`);
    expect(channelPageUrl('@thefaser')).toBe('https://www.youtube.com/@thefaser');
    expect(channelPageUrl('https://www.youtube.com/@thefaser/featured')).toBe('https://www.youtube.com/@thefaser');
    expect(channelPageUrl('https://www.youtube.com/c/SomeName')).toBe('https://www.youtube.com/c/SomeName');
    expect(channelPageUrl('https://m.youtube.com/user/Old?x=1')).toBe('https://www.youtube.com/user/Old');
  });

  it('takes the name from the feed when the page has none', async () => {
    const bare = `<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}">`;
    const provider = new YoutubeProvider((async (url: string | URL | Request) => response(String(url).includes('/feeds/') ? feed : bare)) as unknown as Fetch);
    expect(await provider.lookup('@google')).toMatchObject({ name: 'Google & Friends' });
  });

  it('reports channels YouTube has no page for as a bad request', async () => {
    const provider = new YoutubeProvider((async () => response('', 404)) as unknown as Fetch);
    await expect(provider.lookup('@nobody')).rejects.toMatchObject({ statusCode: 400 });
    const noId = new YoutubeProvider((async () => response('<html></html>')) as unknown as Fetch);
    await expect(noId.lookup('@nobody')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('takes a failing feed as an outage, per channel', async () => {
    const fetchImpl = (async (url: string | URL | Request) =>
      String(url).includes('UCgone') ? response('', 404) : String(url).includes('UCdown') ? response('', 503) : response(feed)) as unknown as Fetch;
    const result = await new YoutubeProvider(fetchImpl).latest(['UCgone', 'UCdown', CHANNEL_ID]);

    expect(result.get('UCgone')).toMatchObject({ kind: 'unavailable' });
    expect(result.get('UCdown')).toMatchObject({ kind: 'unavailable' });
    expect(result.get(CHANNEL_ID)).toHaveLength(2);
  });
});

describe('TwitchProvider', () => {
  it('fetches an app token once and returns live streams per user', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.startsWith('https://id.twitch.tv')) return response({ access_token: 'token', expires_in: 3600 });
      return response({
        data: [{ id: 's1', user_id: '42', user_login: 'neo', user_name: 'Neo', title: 'Coding', game_name: 'Science', viewer_count: 7 }],
      });
    }) as unknown as Fetch;
    const provider = new TwitchProvider('client', 'secret', fetchImpl);

    const first = await provider.latest(['42', '43']);
    await provider.latest(['42']);

    expect(first.get('42')).toMatchObject([{ id: 's1', vars: { 'stream.title': 'Coding', 'stream.url': 'https://www.twitch.tv/neo' } }]);
    expect(first.get('43')).toEqual([]);
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).includes('id.twitch.tv'))).toHaveLength(1);
  });
});

describe('TwitchProvider failures', () => {
  it('marks the users of a failed request as unavailable', async () => {
    const fetchImpl = (async (url: string | URL | Request) =>
      String(url).startsWith('https://id.twitch.tv') ? response({ access_token: 'token', expires_in: 3600 }) : response('', 500)) as unknown as Fetch;
    const result = await new TwitchProvider('client', 'secret', fetchImpl).latest(['42']);

    expect(result.get('42')).toBeInstanceOf(SourceFailure);
    expect(result.get('42')).toMatchObject({ kind: 'unavailable' });
  });
});

const items = (...ids: string[]): FeedItem[] => ids.map((id) => ({ id, vars: {} }));
const ids = (list: FeedItem[]) => list.map((i) => i.id);

describe('freshItems', () => {
  it('announces nothing before the first check', () => {
    expect(freshItems(items('a'), null)).toEqual([]);
  });

  it('announces everything when nothing was seen yet, at most three, oldest first', () => {
    expect(ids(freshItems(items('e', 'd', 'c', 'b', 'a'), []))).toEqual(['c', 'd', 'e']);
  });

  it('takes the unseen items above the first seen one', () => {
    expect(ids(freshItems(items('c', 'b', 'a'), ['a']))).toEqual(['b', 'c']);
  });

  it('survives the newest seen item being deleted', () => {
    expect(ids(freshItems(items('c', 'a', 'z'), ['b', 'a']))).toEqual(['c']);
  });
});

describe('rememberItems', () => {
  it('keeps the current items first, then earlier ones', () => {
    expect(rememberItems(items('c', 'b'), ['b', 'a'])).toEqual(['c', 'b', 'a']);
  });

  it('keeps at most 100 IDs, but always the whole current feed', () => {
    const seen = Array.from({ length: 150 }, (_, i) => `old${i}`);
    expect(rememberItems(items('new'), seen)).toHaveLength(100);
    const feed = items(...Array.from({ length: 120 }, (_, i) => `n${i}`));
    expect(rememberItems(feed, seen)).toHaveLength(120);
  });
});

describe('backoffMs', () => {
  it('retries a single failure as usual, then doubles from 5 minutes up to 6 hours', () => {
    expect(backoffMs(1)).toBe(0);
    expect(backoffMs(2)).toBe(5 * 60_000);
    expect(backoffMs(3)).toBe(10 * 60_000);
    expect(backoffMs(20)).toBe(6 * 60 * 60_000);
  });
});

describe('announcementBody', () => {
  it('writes numbers with a format in the guild language', () => {
    const body = announcementBody({ message: { content: '{item.price:number}' }, mentionRoleId: null }, { 'item.price': 538270 }, 'ru');
    expect(body.content?.replace(/\s/g, ' ')).toBe('538 270');
  });

  it('prepends the subscription role and allows mentioning only it', () => {
    const body = announcementBody(
      { message: { content: 'New: {video.title}', allowedMentions: { users: true, roles: true, everyone: true } }, mentionRoleId: '9' },
      { 'video.title': 'Hello' },
    );
    expect(body).toMatchObject({ content: '<@&9> New: Hello', allowed_mentions: { parse: ['users', 'everyone'], roles: ['9'] } });
  });
});
