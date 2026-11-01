import type { EmbedTemplate, MessageTemplate } from '@bot/contracts';
import type { APIEmbed } from 'discord-api-types/v10';
import { formatValue } from './format.js';

/** Placeholder values: `{ 'user.mention': '<@1>', level: 5 }`. */
export type TemplateVars = Record<string, string | number | null | undefined>;

/** The message after substitution — in Discord API shape, usable with both REST and discord.js. */
export interface RenderedMessage {
  content?: string;
  embeds?: APIEmbed[];
  allowedMentions: { parse: ('users' | 'roles' | 'everyone')[] };
}

/**
 * `{key}` or `{key.sub}`: keys of letters (any script), digits and `_`, starting with a letter; then any formats of
 * the value, each after a `:` (`{price:number}`, `{change:fixed1:signed}`, `{day:dd.mm.yyyy}`, see format.ts). A date mask
 * may hold `.` `/` `-` `_` and spaces.
 */
const PLACEHOLDER = /\{(\p{L}[\p{L}\p{N}_]*(?:\.\p{L}[\p{L}\p{N}_]*)*)((?::[a-z][a-z0-9./_ -]*)*)\}/gu;

const LIMITS = {
  content: 2000,
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  /** Total text of all of a message's embeds. */
  embedsTotal: 6000,
};

/**
 * Substitutes values; unknown placeholders, and ones with a format the bot does not know, stay as they are. No code is
 * executed. Numbers are formatted the `locale`'s way (English without one).
 */
export function renderText(
  text: string,
  vars: TemplateVars,
  value: (key: string, value: string) => string = (_, v) => v,
  locale?: string,
): string {
  return text.replace(PLACEHOLDER, (match, key: string, formats: string) => {
    // Own keys only: `{constructor}` must not reach prototype properties.
    const raw = Object.hasOwn(vars, key) ? vars[key] : undefined;
    if (raw === undefined || raw === null) return match;
    const shown = formats ? formatValue(raw, formats.slice(1).split(':'), locale) : String(raw);
    return shown === null ? match : value(key, shown);
  });
}

/** Keys whose values are mentions the bot built itself (`user`, `user.mention`, `bot.mention`, welcome's `inviter`): they may ping. */
const MENTION_KEY = /^(?:user|inviter)$|(?:^|\.)mention$/;

/**
 * A value that must not ping: what members wrote (command arguments, names, video titles) may hold `<@id>`, `<@&id>`,
 * `@everyone` or `@here`, and the template's allowed mentions are meant for the template's own text. A zero-width
 * space after the @ keeps them shown as text.
 */
export function inertMentions(text: string): string {
  return text.replace(/<@/g, `<@${ZERO_WIDTH_SPACE}`).replace(/@(everyone|here)/g, `@${ZERO_WIDTH_SPACE}$1`);
}

function cleanPlainMentions(text: string, vars: TemplateVars): string {
  const userId = vars['user.id'] ? String(vars['user.id']) : undefined;
  const rawUserDisplay = vars['user.displayName'] ?? vars['user.name'];
  const userDisplay = rawUserDisplay ? String(rawUserDisplay).replace(/^@/, '') : undefined;
  const botId = vars['bot.id'] ? String(vars['bot.id']) : undefined;
  const rawBotName = vars['bot.name'];
  const botName = rawBotName ? String(rawBotName).replace(/^@/, '') : undefined;
  const rawChannelName = vars['channel.name'];
  const channelName = rawChannelName ? String(rawChannelName).replace(/^#/, '') : undefined;

  return text
    .replace(/<@!?id>/gi, () => userDisplay ? `@${userDisplay}` : '@User')
    .replace(/<@!?(\d+)>/g, (_, id) => {
      if (userId && id === userId && userDisplay) return `@${userDisplay}`;
      if (botId && id === botId && botName) return `@${botName}`;
      return `@${id}`;
    })
    .replace(/<@&(?:\d+|id)>/gi, '@Role')
    .replace(/<#(?:\d+|id)>/gi, channelName ? `#${channelName}` : '#channel');
}

function resolveMentionPlaceholders(text: string, vars: TemplateVars): string {
  const userId = vars['user.id'] ? String(vars['user.id']) : undefined;
  if (!userId) return text;
  return text.replace(/<@!?id>/gi, `<@${userId}>`);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function renderEmbed(embed: EmbedTemplate, vars: TemplateVars, locale?: string): APIEmbed {
  const rawUserDisplay = vars['user.displayName'] ?? vars['user.name'];
  const userDisplayName = rawUserDisplay ? String(rawUserDisplay).replace(/^@/, '') : (vars['user.id'] ? 'User' : '');
  const rawBotName = vars['bot.name'];
  const botName = rawBotName ? String(rawBotName).replace(/^@/, '') : '';
  const rawChannelName = vars['channel.name'];
  const channelName = rawChannelName ? String(rawChannelName).replace(/^#/, '') : '';
  const rawInviter = vars['inviter.name'] ?? vars['inviter'];
  const inviterName = rawInviter && !String(rawInviter).startsWith('<@') ? String(rawInviter).replace(/^@/, '') : '';

  // Embed fields where Discord API does not parse mentions: title, author.name, footer.text, fields[].name.
  // Using plainVars ensures placeholders like {user} or {user.mention} resolve to @Name instead of <@id>.
  const plainVars: TemplateVars = {
    ...vars,
    ...(userDisplayName ? { user: `@${userDisplayName}`, 'user.mention': `@${userDisplayName}` } : {}),
    ...(botName ? { 'bot.mention': `@${botName}` } : {}),
    ...(channelName ? { channel: `#${channelName}` } : {}),
    ...(inviterName ? { inviter: `@${inviterName}` } : {}),
  };

  const renderPlain = (value: string) => cleanPlainMentions(renderText(value, plainVars, undefined, locale), vars);
  const renderRich = (value: string) => resolveMentionPlaceholders(renderText(value, vars, undefined, locale), vars);

  const plainText = (value: string | undefined, max: number) => (value === undefined ? undefined : truncate(renderPlain(value), max));
  const richText = (value: string | undefined, max: number) => (value === undefined ? undefined : truncate(renderRich(value), max));
  const url = (value: string | undefined) => {
    const rendered = value === undefined ? undefined : renderPlain(value);
    if (!rendered) return undefined;
    try {
      const parsed = new URL(rendered);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
    } catch {
      return undefined;
    }
  };

  let color: number | undefined;
  if (typeof embed.color === 'number') {
    color = embed.color;
  } else if (typeof embed.color === 'string') {
    const renderedColor = renderPlain(embed.color).trim();
    const parsedHex = /^(?:#[\da-f]{1,6}|0x[\da-f]{1,6})$/i.test(renderedColor)
      ? parseInt(renderedColor.replace(/^(#|0x)/i, ''), 16)
      : /^\d+$/.test(renderedColor)
        ? Number(renderedColor)
        : /^[\da-f]{6}$/i.test(renderedColor)
          ? parseInt(renderedColor, 16)
          : NaN;
    if (!Number.isNaN(parsedHex) && parsedHex >= 0 && parsedHex <= 0xffffff) {
      color = parsedHex;
    }
  }

  let timestamp: string | undefined;
  if (typeof embed.timestamp === 'boolean') {
    timestamp = embed.timestamp ? new Date().toISOString() : undefined;
  } else if (typeof embed.timestamp === 'string') {
    const renderedTs = renderPlain(embed.timestamp).trim();
    if (renderedTs === 'true' || renderedTs.toLowerCase() === 'now') {
      timestamp = new Date().toISOString();
    } else if (renderedTs) {
      const parsed = new Date(renderedTs);
      if (!Number.isNaN(parsed.getTime())) {
        timestamp = parsed.toISOString();
      }
    }
  }

  const authorName = embed.author?.name ? plainText(embed.author.name, LIMITS.author) : undefined;
  const author = authorName
    ? {
        name: authorName,
        url: url(embed.author?.url),
        icon_url: url(embed.author?.iconUrl),
      }
    : undefined;

  const footerText = embed.footer?.text ? plainText(embed.footer.text, LIMITS.footer) : undefined;
  const footer = footerText
    ? {
        text: footerText,
        icon_url: url(embed.footer?.iconUrl),
      }
    : undefined;

  const thumbUrl = url(embed.thumbnailUrl);
  const imgUrl = url(embed.imageUrl);

  const fields = embed.fields?.map((field) => ({
    name: plainText(field.name, LIMITS.fieldName) || '\u200b',
    value: richText(field.value, LIMITS.fieldValue) || '\u200b',
    inline: field.inline,
  }));

  const result: APIEmbed = {
    title: plainText(embed.title, LIMITS.title),
    description: richText(embed.description, LIMITS.description),
    url: url(embed.url),
    color,
    author,
    thumbnail: thumbUrl ? { url: thumbUrl } : undefined,
    image: imgUrl ? { url: imgUrl } : undefined,
    fields,
    footer,
    timestamp,
  };
  return JSON.parse(JSON.stringify(result)) as APIEmbed;
}

function embedLength(embed: APIEmbed): number {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}

/**
 * Renders a template within Discord limits: long fields are truncated,
 * embeds beyond the 6000 character total are dropped. `@everyone` and roles only when explicit.
 *
 * Only the template's own text and the bot's mention values ping: the other values are made inert
 * (`inertMentions`). `mentionKeys` — more keys whose values are mentions the bot resolved (a command's user or role
 * options). `locale` — how numbers with a format are written (the guild's language).
 */
export function renderMessage(
  template: MessageTemplate,
  vars: TemplateVars,
  { mentionKeys = [], locale }: { mentionKeys?: readonly string[]; locale?: string } = {},
): RenderedMessage {
  const mentions = template.allowedMentions ?? { users: true, roles: false, everyone: false };
  const everyone = mentions.everyone;
  const here = mentions.here ?? mentions.everyone;
  const value = (key: string, text: string) => (MENTION_KEY.test(key) || mentionKeys.includes(key) ? text : inertMentions(text));
  const content = template.content
    ? truncate(defuseMentions(resolveMentionPlaceholders(renderText(template.content, vars, value, locale), vars), { everyone, here }), LIMITS.content)
    : undefined;

  const embeds: APIEmbed[] = [];
  let total = 0;
  for (const embed of template.embeds ?? []) {
    const rendered = renderEmbed(embed, vars, locale);
    total += embedLength(rendered);
    if (total > LIMITS.embedsTotal) break;
    embeds.push(rendered);
  }

  const parse: RenderedMessage['allowedMentions']['parse'] = [];
  if (mentions.users) parse.push('users');
  if (mentions.roles) parse.push('roles');
  // Discord allows @everyone and @here only together; the one not allowed is defused in the text above.
  if (everyone || here) parse.push('everyone');

  return {
    ...(content?.trim() ? { content } : {}),
    ...(embeds.length > 0 ? { embeds } : {}),
    allowedMentions: { parse },
  };
}

/**
 * `@everyone` / `@here` that may not ping, with a zero-width space after the @: shown the same, pings nobody.
 * Only the text pings — embeds never do.
 */
export function defuseMentions(text: string, allowed: { everyone: boolean; here: boolean }): string {
  // Both or neither: allowed_mentions alone decides.
  if (allowed.everyone === allowed.here) return text;
  const blocked = allowed.everyone ? 'here' : 'everyone';
  return text.replace(new RegExp(`@${blocked}(?![a-z0-9_])`, 'g'), `@${ZERO_WIDTH_SPACE}${blocked}`);
}

/** Shown as nothing; after an @ it keeps the mention from pinging. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

/** Body for Discord REST (`POST /channels/:id/messages`). */
export function toRestMessage(message: RenderedMessage) {
  return {
    content: message.content,
    embeds: message.embeds,
    allowed_mentions: { parse: message.allowedMentions.parse },
  };
}
