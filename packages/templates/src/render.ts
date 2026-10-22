import type { EmbedTemplate, MessageTemplate } from '@bot/contracts';
import type { APIEmbed } from 'discord-api-types/v10';

/** Placeholder values: `{ 'user.mention': '<@1>', level: 5 }`. */
export type TemplateVars = Record<string, string | number | null | undefined>;

/** The message after substitution — in Discord API shape, usable with both REST and discord.js. */
export interface RenderedMessage {
  content?: string;
  embeds?: APIEmbed[];
  allowedMentions: { parse: ('users' | 'roles' | 'everyone')[] };
}

/** `{key}` or `{key.sub}`: keys of letters (any script), digits and `_`, starting with a letter. */
const PLACEHOLDER = /\{(\p{L}[\p{L}\p{N}_]*(?:\.\p{L}[\p{L}\p{N}_]*)*)\}/gu;

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

/** Substitutes values; unknown placeholders stay as they are. No code is executed. */
export function renderText(text: string, vars: TemplateVars, value: (key: string, value: string) => string = (_, v) => v): string {
  return text.replace(PLACEHOLDER, (match, key: string) => {
    // Own keys only: `{constructor}` must not reach prototype properties.
    const raw = Object.hasOwn(vars, key) ? vars[key] : undefined;
    return raw === undefined || raw === null ? match : value(key, String(raw));
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function renderEmbed(embed: EmbedTemplate, vars: TemplateVars): APIEmbed {
  const text = (value: string | undefined, max: number) => (value === undefined ? undefined : truncate(renderText(value, vars), max));
  const url = (value: string | undefined) => {
    const rendered = value === undefined ? undefined : renderText(value, vars);
    return rendered && /^https?:\/\//.test(rendered) ? rendered : undefined;
  };

  const result: APIEmbed = {
    title: text(embed.title, LIMITS.title),
    description: text(embed.description, LIMITS.description),
    url: url(embed.url),
    color: embed.color,
    author: embed.author && { name: text(embed.author.name, LIMITS.author)!, url: url(embed.author.url), icon_url: url(embed.author.iconUrl) },
    thumbnail: url(embed.thumbnailUrl) ? { url: url(embed.thumbnailUrl)! } : undefined,
    image: url(embed.imageUrl) ? { url: url(embed.imageUrl)! } : undefined,
    fields: embed.fields?.map((field) => ({
      name: text(field.name, LIMITS.fieldName)!,
      value: text(field.value, LIMITS.fieldValue)!,
      inline: field.inline,
    })),
    footer: embed.footer && { text: text(embed.footer.text, LIMITS.footer)!, icon_url: url(embed.footer.iconUrl) },
    timestamp: embed.timestamp ? new Date().toISOString() : undefined,
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
 * options).
 */
export function renderMessage(template: MessageTemplate, vars: TemplateVars, { mentionKeys = [] }: { mentionKeys?: readonly string[] } = {}): RenderedMessage {
  const mentions = template.allowedMentions ?? { users: true, roles: false, everyone: false };
  const everyone = mentions.everyone;
  const here = mentions.here ?? mentions.everyone;
  const value = (key: string, text: string) => (MENTION_KEY.test(key) || mentionKeys.includes(key) ? text : inertMentions(text));
  const content = template.content
    ? truncate(defuseMentions(renderText(template.content, vars, value), { everyone, here }), LIMITS.content)
    : undefined;

  const embeds: APIEmbed[] = [];
  let total = 0;
  for (const embed of template.embeds ?? []) {
    const rendered = renderEmbed(embed, vars);
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
