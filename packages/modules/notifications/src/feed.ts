import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { FeedItem } from './providers.js';

// RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed into one shape. Feeds are written by hand as often as by tools,
// so every field is optional and read leniently.

export interface ParsedFeed {
  title: string;
  /** The site the feed belongs to. */
  link: string | null;
  /** Newest first. */
  items: FeedItem[];
}

/** How many items of a feed are looked at; the rest are older and only cost memory. */
const MAX_ITEMS = 100;
const SUMMARY_LENGTH = 300;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  cdataPropName: '__cdata',
  // Entities are decoded below, by hand: a DOCTYPE's own entities are never expanded.
  processEntities: false,
  htmlEntities: false,
});

/** The named entities feeds actually use; the rest are rare and stay as they are. */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  bull: '•',
  middot: '·',
  times: '×',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  deg: '°',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/** HTML of a description as plain text: tags out, paragraphs kept as line breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

type Node = unknown;
const list = (node: Node): Node[] => (node === undefined || node === null ? [] : Array.isArray(node) ? node : [node]);
const attr = (node: Node, name: string): string => {
  const value = (node as Record<string, unknown> | null)?.[`@_${name}`];
  return typeof value === 'string' ? decodeEntities(value.trim()) : '';
};

/** A node's text: CDATA as it is, the rest with entities decoded. */
function text(node: Node): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return decodeEntities(String(node)).trim();
  if (Array.isArray(node)) return text(node[0]);
  const record = node as Record<string, unknown>;
  const cdata = list(record.__cdata).map(String).join('');
  return (cdata + (record['#text'] === undefined ? '' : decodeEntities(String(record['#text'])))).trim();
}

const absolute = (url: string, base: string | null): string => {
  if (!url) return '';
  try {
    const resolved = new URL(url, base ?? undefined);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : '';
  } catch {
    return '';
  }
};

const firstImage = (html: string) => /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(html)?.[1] ?? '';

interface Raw {
  id: string;
  url: string;
  title: string;
  html: string;
  author: string;
  image: string;
  date: string;
}

function toItem(raw: Raw, feed: { title: string; link: string | null }, base: string | null): FeedItem & { time: number } {
  const url = absolute(raw.url, base);
  const summary = htmlToText(raw.html);
  const title = htmlToText(raw.title) || truncate(summary, 100);
  const id = raw.id || url || createHash('sha1').update(`${title}\n${raw.date}`).digest('hex');
  return {
    id,
    time: Date.parse(raw.date),
    text: `${title}\n${summary}`,
    vars: {
      'item.title': title,
      'item.url': url,
      'item.summary': truncate(summary, SUMMARY_LENGTH),
      'item.author': raw.author,
      'item.image': absolute(raw.image || firstImage(raw.html), base),
      'feed.name': feed.title,
      'feed.url': feed.link ?? '',
    },
  };
}

/** Newest first: by date when every item has one (some feeds list the oldest first), else in the feed's order. */
function newestFirst(items: (FeedItem & { time: number })[]): FeedItem[] {
  const dated = items.every((item) => Number.isFinite(item.time));
  const sorted = dated ? [...items].sort((a, b) => b.time - a.time) : items;
  return sorted.slice(0, MAX_ITEMS).map(({ time: _time, ...item }) => item);
}

function rssImage(item: Record<string, Node>): string {
  const enclosure = list(item.enclosure).find((e) => attr(e, 'type').startsWith('image/'));
  if (enclosure) return attr(enclosure, 'url');
  const thumbnail = list(item.thumbnail)[0] ?? list((item.group as Record<string, Node> | undefined)?.thumbnail)[0];
  if (thumbnail) return attr(thumbnail, 'url');
  const media = list(item.content).find((c) => attr(c, 'medium') === 'image' || attr(c, 'type').startsWith('image/'));
  return media ? attr(media, 'url') : '';
}

function parseRss(channel: Record<string, Node>, entries: Node[], base: string): ParsedFeed {
  const link = absolute(text(list(channel.link).find((l) => typeof l === 'string' || text(l)) ?? ''), base) || null;
  const feed = { title: htmlToText(text(channel.title)), link };
  const items = entries.map((node) => {
    const item = node as Record<string, Node>;
    const guid = text(item.guid);
    const itemLink = text(item.link) || (attr(item.guid, 'isPermaLink') !== 'false' && /^https?:/.test(guid) ? guid : '');
    return toItem(
      {
        id: guid || attr(node, 'about'),
        url: itemLink,
        title: text(item.title),
        // content:encoded is the full text, description often only a teaser.
        html: text(item.encoded) || text(item.description),
        author: text(item.creator) || text(item.author),
        image: rssImage(item),
        date: text(item.pubDate) || text(item.date),
      },
      feed,
      link ?? base,
    );
  });
  return { ...feed, items: newestFirst(items) };
}

const atomLink = (node: Node) => {
  const links = list(node);
  const alternate = links.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate') ?? links[0];
  return alternate === undefined ? '' : attr(alternate, 'href') || text(alternate);
};

function parseAtom(root: Record<string, Node>, base: string): ParsedFeed {
  const link = absolute(atomLink(root.link), base) || null;
  const feed = { title: htmlToText(text(root.title)), link };
  const items = list(root.entry).map((node) => {
    const entry = node as Record<string, Node>;
    const group = entry.group as Record<string, Node> | undefined;
    const thumbnail = list(entry.thumbnail)[0] ?? list(group?.thumbnail)[0];
    return toItem(
      {
        id: text(entry.id),
        url: atomLink(entry.link),
        title: text(entry.title),
        html: text(entry.content) || text(entry.summary) || text(group?.description),
        author: text((list(entry.author)[0] as Record<string, Node> | undefined)?.name),
        image: thumbnail ? attr(thumbnail, 'url') : '',
        date: text(entry.published) || text(entry.updated),
      },
      feed,
      link ?? base,
    );
  });
  return { ...feed, items: newestFirst(items) };
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');

function parseJsonFeed(json: Record<string, unknown>, base: string): ParsedFeed {
  const link = absolute(str(json.home_page_url), base) || null;
  const feed = { title: str(json.title), link };
  const items = list(json.items).map((node) => {
    const item = (node ?? {}) as Record<string, unknown>;
    const author = (list(item.authors)[0] ?? item.author) as Record<string, unknown> | undefined;
    const html = str(item.content_html) || str(item.summary) || str(item.content_text).replace(/</g, '&lt;');
    return toItem(
      {
        id: str(item.id),
        url: str(item.url) || str(item.external_url),
        title: str(item.title).replace(/</g, '&lt;'),
        html,
        author: str(author?.name),
        image: str(item.image) || str(item.banner_image),
        date: str(item.date_published) || str(item.date_modified),
      },
      feed,
      link ?? base,
    );
  });
  return { ...feed, items: newestFirst(items) };
}

/** A feed from the body at `url`; null when the body is not a feed (an HTML page, say). */
export function parseFeed(body: string, url: string): ParsedFeed | null {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      return typeof json.version === 'string' && json.version.includes('jsonfeed.org') ? parseJsonFeed(json, url) : null;
    } catch {
      return null;
    }
  }
  if (!trimmed.startsWith('<')) return null;
  let doc: Record<string, Node>;
  try {
    doc = parser.parse(trimmed) as Record<string, Node>;
  } catch {
    return null;
  }
  if (doc.rss) {
    const channel = ((doc.rss as Record<string, Node>).channel ?? {}) as Record<string, Node>;
    return parseRss(channel, list(channel.item), url);
  }
  if (doc.RDF) {
    const rdf = doc.RDF as Record<string, Node>;
    return parseRss((rdf.channel ?? {}) as Record<string, Node>, list(rdf.item), url);
  }
  if (doc.feed) return parseAtom(doc.feed as Record<string, Node>, url);
  return null;
}

const FEED_TYPES = ['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json', 'application/rdf+xml'];

/** The feed a web page points to in its `<link rel="alternate">`, if it does. */
export function discoverFeed(html: string, pageUrl: string): string | null {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(([, k, v]) => [k!.toLowerCase(), decodeEntities(v!)]));
    if (attrs.rel?.toLowerCase().split(/\s+/).includes('alternate') && FEED_TYPES.includes(attrs.type?.toLowerCase() ?? '') && attrs.href) {
      return absolute(attrs.href, pageUrl) || null;
    }
  }
  return null;
}
