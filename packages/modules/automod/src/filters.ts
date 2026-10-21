import type { AutomodConfig } from './config.js';
import { cached, wordsRegex } from './patterns.js';

// Checks of a single message against the filters that need nothing but the message itself.
// Plain functions of text: easy to test without discord.js.

const INVITE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/([\w-]+)/gi;
const URL = /\bhttps?:\/\/([^\s/?#<>]+)/gi;
const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const EMOJI = /\p{Extended_Pictographic}/gu;

export function inviteCodes(text: string): string[] {
  return [...text.matchAll(INVITE)].map((m) => m[1]!);
}

/** Hosts of the links in the text, lowercase, without `www.` and the port. */
export function linkDomains(text: string): string[] {
  return [...text.matchAll(URL)].map((m) => m[1]!.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, ''));
}

/** The domain or one of its subdomains is in the list. */
export function domainListed(domain: string, list: readonly string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Links that break the filter; invites are left to their own filter. */
export function badLinks(text: string, filter: AutomodConfig['filters']['links']): string[] {
  const inviteHosts = ['discord.gg', 'discord.com', 'discordapp.com', 'dsc.gg'];
  const hasInvite = inviteCodes(text).length > 0;
  return linkDomains(text).filter((domain) => {
    if (hasInvite && inviteHosts.includes(domain)) return false;
    return filter.mode === 'all' ? !domainListed(domain, filter.allowedDomains) : domainListed(domain, filter.blockedDomains);
  });
}

/** Share of capital letters among letters that have a case, in percent. */
export function capsPercent(text: string): { percent: number; letters: number } {
  const letters = [...text.replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, '')].filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (letters.length === 0) return { percent: 0, letters: 0 };
  const upper = letters.filter((c) => c === c.toUpperCase()).length;
  return { percent: Math.round((upper / letters.length) * 100), letters: letters.length };
}

export function emojiCount(text: string): number {
  const custom = text.match(CUSTOM_EMOJI)?.length ?? 0;
  return custom + (text.replace(CUSTOM_EMOJI, '').match(EMOJI)?.length ?? 0);
}

/** The banned word or pattern found in the text, or `null`. */
export function bannedWord(text: string, filter: AutomodConfig['filters']['words']): string | null {
  const words = cached(`w:${filter.words.join('\u0000')}`, () => wordsRegex(filter.words));
  const found = words?.exec(text);
  if (found) return found[0];
  for (const pattern of filter.patterns) {
    const match = cached(`p:${pattern}`, () => new RegExp(pattern, 'iu'))?.exec(text.slice(0, 2000));
    if (match) return match[0];
  }
  return null;
}

export interface MessageFacts {
  content: string;
  /** Users and roles mentioned, @everyone and @here counted too. */
  mentions: number;
}

/** What the stateless filters say of a message: the first one it breaks and what was found. */
export function staticViolation(
  filters: AutomodConfig['filters'],
  message: MessageFacts,
  applies: (name: keyof AutomodConfig['filters']) => boolean,
): { filter: 'links' | 'caps' | 'mentions' | 'words' | 'emojis'; detail: string } | null {
  const text = message.content;
  if (applies('words')) {
    const word = bannedWord(text, filters.words);
    if (word) return { filter: 'words', detail: word };
  }
  if (applies('links')) {
    const links = badLinks(text, filters.links);
    if (links.length > 0) return { filter: 'links', detail: links.join(', ') };
  }
  if (applies('mentions') && message.mentions > filters.mentions.max) return { filter: 'mentions', detail: String(message.mentions) };
  if (applies('caps')) {
    const caps = capsPercent(text);
    if (caps.letters >= filters.caps.minLength && caps.percent >= filters.caps.percent) return { filter: 'caps', detail: `${caps.percent}%` };
  }
  if (applies('emojis')) {
    const count = emojiCount(text);
    if (count > filters.emojis.max) return { filter: 'emojis', detail: String(count) };
  }
  return null;
}
