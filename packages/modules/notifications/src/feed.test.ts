import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { matchesFilter, storedFilter } from './config.js';
import { discoverFeed, htmlToText, parseFeed } from './feed.js';
import { FeedProvider, feedUrl, SourceFailure } from './providers.js';
import { createSafeFetch, decodeBody, FetchRefused, isPublicAddress, type FetchedText, type FetchText } from './safe-fetch.js';
import { payloadVars } from './webhook.js';

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Tom &amp; Jerry blog</title>
    <link>https://blog.example/</link>
    <atom:link href="https://blog.example/feed" rel="self" type="application/rss+xml"/>
    <item>
      <title>Older post</title>
      <link>/posts/1</link>
      <guid isPermaLink="false">post-1</guid>
      <pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate>
      <description>&lt;p&gt;First &amp;amp; best&lt;/p&gt;</description>
    </item>
    <item>
      <title><![CDATA[Newer <post>]]></title>
      <link>https://blog.example/posts/2</link>
      <guid>https://blog.example/posts/2</guid>
      <pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate>
      <dc:creator>Tom</dc:creator>
      <description>Teaser</description>
      <content:encoded><![CDATA[<p>Full <b>text</b></p><img src="/img/2.png">]]></content:encoded>
    </item>
  </channel>
</rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title type="html">Releases &amp;lt;v2&amp;gt;</title>
  <link rel="self" href="https://github.com/o/r/releases.atom"/>
  <link rel="alternate" type="text/html" href="https://github.com/o/r/releases"/>
  <entry>
    <id>tag:github.com,2008:Repository/1/v2.0.0</id>
    <updated>2026-10-27T10:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/v2.0.0"/>
    <title>v2.0.0</title>
    <content type="html">&lt;h1&gt;Changes&lt;/h1&gt;&lt;ul&gt;&lt;li&gt;New&lt;/li&gt;&lt;/ul&gt;</content>
    <author><name>octocat</name></author>
    <media:thumbnail url="https://avatars.example/1.png"/>
  </entry>
</feed>`;

const jsonFeed = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON news',
  home_page_url: 'https://json.example/',
  items: [{ id: 1, url: 'https://json.example/1', title: 'One', content_text: 'Plain <text>', authors: [{ name: 'Ann' }] }],
});

describe('parseFeed', () => {
  it('reads RSS 2.0 newest first, with full text, author, image and resolved links', () => {
    const feed = parseFeed(rss, 'https://blog.example/feed')!;

    expect(feed.title).toBe('Tom & Jerry blog');
    expect(feed.link).toBe('https://blog.example/');
    expect(feed.items.map((i) => i.id)).toEqual(['https://blog.example/posts/2', 'post-1']);
    expect(feed.items[0]!.vars).toEqual({
      'item.title': 'Newer',
      'item.url': 'https://blog.example/posts/2',
      'item.summary': 'Full text',
      'item.author': 'Tom',
      'item.image': 'https://blog.example/img/2.png',
      'feed.name': 'Tom & Jerry blog',
      'feed.url': 'https://blog.example/',
    });
    expect(feed.items[1]!.vars).toMatchObject({ 'item.url': 'https://blog.example/posts/1', 'item.summary': 'First & best' });
  });

  it('reads Atom with HTML content and a media thumbnail', () => {
    const feed = parseFeed(atom, 'https://github.com/o/r/releases.atom')!;

    expect(feed).toMatchObject({ title: 'Releases <v2>', link: 'https://github.com/o/r/releases' });
    expect(feed.items[0]).toMatchObject({
      id: 'tag:github.com,2008:Repository/1/v2.0.0',
      vars: { 'item.url': 'https://github.com/o/r/releases/tag/v2.0.0', 'item.summary': 'Changes\nNew', 'item.author': 'octocat', 'item.image': 'https://avatars.example/1.png' },
    });
  });

  it('reads RSS 1.0 (RDF)', () => {
    const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
      <channel rdf:about="https://rdf.example/"><title>RDF</title><link>https://rdf.example/</link></channel>
      <item rdf:about="https://rdf.example/a"><title>A</title><link>https://rdf.example/a</link></item></rdf:RDF>`;
    expect(parseFeed(rdf, 'https://rdf.example/rss')!.items.map((i) => i.id)).toEqual(['https://rdf.example/a']);
  });

  it('reads JSON Feed, keeping plain text plain', () => {
    const feed = parseFeed(jsonFeed, 'https://json.example/feed.json')!;
    expect(feed.items[0]).toMatchObject({ id: '1', vars: { 'item.title': 'One', 'item.summary': 'Plain <text>', 'item.author': 'Ann' } });
  });

  it('keeps the feed order when items have no dates', () => {
    // The sample lists the oldest post first; dated, it is sorted (see above), undated it is not.
    const undated = rss.replace(/<pubDate>[^<]*<\/pubDate>/g, '');
    expect(parseFeed(undated, 'https://blog.example/feed')!.items[0]!.id).toBe('post-1');
  });

  it('gives items without guid or link a stable id', () => {
    const feed = `<rss><channel><title>T</title><item><title>Only a title</title></item></channel></rss>`;
    const [a] = parseFeed(feed, 'https://x.example/')!.items;
    const [b] = parseFeed(feed, 'https://x.example/')!.items;
    expect(a!.id).toMatch(/^[\da-f]{40}$/);
    expect(a!.id).toBe(b!.id);
  });

  it('does not expand entities a DOCTYPE defines', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><rss><channel><title>&b;</title></channel></rss>`;
    expect(parseFeed(bomb, 'https://x.example/')?.title ?? '').not.toContain('aaaa');
  });

  it('is null for what is not a feed', () => {
    expect(parseFeed('<!doctype html><html><head></head></html>', 'https://x.example/')).toBeNull();
    expect(parseFeed('{"hello":1}', 'https://x.example/')).toBeNull();
    expect(parseFeed('plain', 'https://x.example/')).toBeNull();
  });
});

describe('discoverFeed', () => {
  it('finds the feed a page links to', () => {
    const html = `<html><head><link rel="stylesheet" href="/a.css"><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml"></head></html>`;
    expect(discoverFeed(html, 'https://site.example/blog/')).toBe('https://site.example/feed.xml');
    expect(discoverFeed('<html></html>', 'https://site.example/')).toBeNull();
  });
});

describe('htmlToText', () => {
  it('drops tags and scripts, keeps paragraphs', () => {
    expect(htmlToText('<p>One&nbsp;&mdash; two</p><script>x()</script><p>We&rsquo;re<br>four</p>')).toBe('One — two\nWe’re\nfour');
  });
});

describe('filters', () => {
  it('needs one of the included words and none of the excluded, ignoring case', () => {
    const filter = { include: ['release', 'Обновление'], exclude: ['#shorts'] };
    expect(matchesFilter(filter, 'New RELEASE out')).toBe(true);
    expect(matchesFilter(filter, 'большое обновление')).toBe(true);
    expect(matchesFilter(filter, 'Release #Shorts')).toBe(false);
    expect(matchesFilter(filter, 'Something else')).toBe(false);
    expect(matchesFilter({ include: [], exclude: [] }, 'anything')).toBe(true);
  });

  it('lets everything through when nothing or something broken is stored', () => {
    expect(storedFilter(null)).toEqual({ include: [], exclude: [] });
    expect(storedFilter({ include: 'oops' })).toEqual({ include: [], exclude: [] });
  });
});

describe('feedUrl', () => {
  it('takes a link without a scheme as https and refuses other schemes', () => {
    expect(feedUrl('blog.example/feed#top').toString()).toBe('https://blog.example/feed');
    expect(() => feedUrl('ftp://blog.example/feed')).toThrow();
    expect(() => feedUrl('file:///etc/passwd')).toThrow();
  });
});

const fetched = (body: string, status = 200, url = 'https://blog.example/feed', headers: FetchedText['headers'] = {}): FetchedText => ({ url, status, headers, body });

describe('FeedProvider', () => {
  it('looks a feed up directly or through the page that links to it', async () => {
    const fetchText = vi.fn<FetchText>(async (url) =>
      url.endsWith('/feed.xml') ? fetched(rss, 200, url) : fetched('<link rel="alternate" type="application/atom+xml" href="/feed.xml">', 200, url),
    );
    const provider = new FeedProvider(fetchText);

    expect(await provider.lookup('blog.example')).toEqual({ externalId: 'https://blog.example/feed.xml', name: 'Tom & Jerry blog', url: 'https://blog.example/' });
    expect(fetchText).toHaveBeenCalledWith('https://blog.example/');
  });

  it('refuses addresses without a feed as a bad request', async () => {
    const provider = new FeedProvider(async (url) => fetched('<html></html>', 200, url));
    await expect(provider.lookup('https://nothing.example/')).rejects.toMatchObject({ statusCode: 400 });
    const refused = new FeedProvider(async () => {
      throw new FetchRefused('127.0.0.1 is not a public address');
    });
    await expect(refused.lookup('http://127.0.0.1/')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('asks "changed since?" and reuses the items on a 304', async () => {
    const fetchText = vi
      .fn<FetchText>()
      .mockResolvedValueOnce(fetched(rss, 200, 'https://blog.example/feed', { etag: '"v1"' }))
      .mockResolvedValueOnce(fetched('', 304));
    const provider = new FeedProvider(fetchText);

    const first = await provider.latest(['https://blog.example/feed']);
    const second = await provider.latest(['https://blog.example/feed']);

    expect(fetchText.mock.calls[1]![1]).toEqual({ 'if-none-match': '"v1"' });
    expect(second.get('https://blog.example/feed')).toEqual(first.get('https://blog.example/feed'));
  });

  it('tells what went wrong with a feed', async () => {
    const responses: Record<string, () => Promise<FetchedText>> = {
      'https://gone.example/': async () => fetched('', 410),
      'https://down.example/': async () => fetched('', 503),
      'https://html.example/': async () => fetched('<html></html>'),
      'https://private.example/': async () => {
        throw new FetchRefused('not public');
      },
      'https://offline.example/': async () => {
        throw new Error('ENOTFOUND');
      },
    };
    const result = await new FeedProvider((url) => responses[url]!()).latest(Object.keys(responses));

    expect(Object.fromEntries([...result].map(([url, r]) => [url, r instanceof SourceFailure ? r.kind : 'ok']))).toEqual({
      'https://gone.example/': 'notFound',
      'https://down.example/': 'unavailable',
      'https://html.example/': 'invalid',
      'https://private.example/': 'invalid',
      'https://offline.example/': 'unavailable',
    });
  });
});

describe('isPublicAddress', () => {
  it('allows the public internet only', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(address)).toBe(true);
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'localhost']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe('decodeBody', () => {
  it('uses the charset of the header or of the XML declaration', () => {
    const cp1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // "Привет"
    expect(decodeBody(cp1251, 'text/xml; charset=windows-1251')).toBe('Привет');
    const xml = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1251"?>'), cp1251]);
    expect(decodeBody(xml, 'text/xml')).toContain('Привет');
    expect(decodeBody(Buffer.from('ok'), 'text/xml; charset=nonsense')).toBe('ok');
  });
});

describe('createSafeFetch', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') return res.writeHead(302, { location: '/feed' }).end();
      if (req.url === '/to-private') return res.writeHead(302, { location: 'http://10.0.0.1/feed' }).end();
      if (req.url === '/loop') return res.writeHead(302, { location: '/loop' }).end();
      if (req.url === '/big') return res.end('x'.repeat(2048));
      if (req.url === '/bomb') return res.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync('x'.repeat(100_000)));
      res.writeHead(200, { 'content-type': 'application/rss+xml', etag: '"1"' }).end(rss);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const loopbackAllowed = (address: string) => address === '127.0.0.1' || isPublicAddress(address);

  it('refuses loopback and private addresses, by IP or by name', async () => {
    const safeFetch = createSafeFetch();
    await expect(safeFetch(`${base}/feed`)).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeFetch(`http://localhost:${new URL(base).port}/feed`)).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeFetch('http://[::1]/')).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeFetch('file:///etc/passwd')).rejects.toBeInstanceOf(FetchRefused);
  });

  it('follows redirects, but not to private addresses and not forever', async () => {
    const safeFetch = createSafeFetch({ isAllowed: loopbackAllowed });
    const response = await safeFetch(`${base}/redirect`);
    expect(response).toMatchObject({ url: `${base}/feed`, status: 200, headers: { etag: '"1"' } });
    expect(response.body).toContain('Tom &amp; Jerry');
    await expect(safeFetch(`${base}/to-private`)).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeFetch(`${base}/loop`)).rejects.toThrow('Too many redirects');
  });

  it('stops reading a body past the limit, counting it unpacked', async () => {
    const safeFetch = createSafeFetch({ isAllowed: loopbackAllowed, maxBytes: 1024 });
    await expect(safeFetch(`${base}/big`)).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeFetch(`${base}/bomb`)).rejects.toBeInstanceOf(FetchRefused);
  });
});

describe('payloadVars', () => {
  it('turns a JSON body into placeholders, arrays into count, first, last and items', () => {
    const { vars, text } = payloadVars({
      title: 'Deploy',
      'x-id': 7,
      '2fa': 'dropped',
      ok: true,
      tags: ['a', 'b'],
      commits: [{ message: 'One' }, { message: 'Two' }, { message: 'Three' }],
      empty: null,
    });
    expect(vars).toEqual({
      'body.title': 'Deploy',
      'body.x_id': 7,
      'body.ok': 'true',
      'body.tags.count': 2,
      'body.tags.items': 'a, b',
      'body.tags.first': 'a',
      'body.tags.last': 'b',
      'body.commits.count': 3,
      'body.commits.first.message': 'One',
      'body.commits.last.message': 'Three',
    });
    expect(text).toContain('Deploy');
  });

  it('takes a text body as body.text and keeps deep or excess fields out', () => {
    expect(payloadVars('plain').vars).toEqual({ 'body.text': 'plain' });
    const deep = payloadVars({ a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } });
    expect(Object.keys(deep.vars)).toEqual([]);
    const many = payloadVars(Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, 'v'])));
    expect(Object.keys(many.vars)).toHaveLength(300);
    expect(String(payloadVars({ long: 'x'.repeat(5000) }).vars['body.long'])).toHaveLength(1000);
  });
});
