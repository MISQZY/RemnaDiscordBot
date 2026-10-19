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

const PLACEHOLDER = /\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\}/gi;

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
export function renderText(text: string, vars: TemplateVars): string {
  return text.replace(PLACEHOLDER, (match, key: string) => {
    // Own keys only: `{constructor}` must not reach prototype properties.
    const value = Object.hasOwn(vars, key) ? vars[key] : undefined;
    return value === undefined || value === null ? match : String(value);
  });
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
 */
export function renderMessage(template: MessageTemplate, vars: TemplateVars): RenderedMessage {
  const content = template.content ? truncate(renderText(template.content, vars), LIMITS.content) : undefined;

  const embeds: APIEmbed[] = [];
  let total = 0;
  for (const embed of template.embeds ?? []) {
    const rendered = renderEmbed(embed, vars);
    total += embedLength(rendered);
    if (total > LIMITS.embedsTotal) break;
    embeds.push(rendered);
  }

  const mentions = template.allowedMentions ?? { users: true, roles: false, everyone: false };
  const parse: RenderedMessage['allowedMentions']['parse'] = [];
  if (mentions.users) parse.push('users');
  if (mentions.roles) parse.push('roles');
  if (mentions.everyone) parse.push('everyone');

  return {
    ...(content?.trim() ? { content } : {}),
    ...(embeds.length > 0 ? { embeds } : {}),
    allowedMentions: { parse },
  };
}

/** Body for Discord REST (`POST /channels/:id/messages`). */
export function toRestMessage(message: RenderedMessage) {
  return {
    content: message.content,
    embeds: message.embeds,
    allowed_mentions: { parse: message.allowedMentions.parse },
  };
}
