import type { BotModuleContext } from '@bot/core';
import { ChannelType, PermissionFlagsBits, type APIEmbed, type GuildTextBasedChannel, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction } from 'discord.js';
import type { StarboardConfig } from './config.js';

type Ctx = BotModuleContext<StarboardConfig>;

/** The reaction is the board's emoji: a Unicode one by itself, a custom one by its id. */
export function matchesEmoji(configured: string, emoji: { id: string | null; name: string | null }): boolean {
  const custom = /^<a?:\w+:(\d+)>$/.exec(configured);
  return custom ? emoji.id === custom[1] : emoji.name === configured;
}

/** The board's copy: the text, the first image, a link back. */
export function starboardBody(message: Pick<Message, 'content' | 'url' | 'channelId' | 'createdTimestamp'> & { author: { username: string; avatarURL: string | null }; image: string | null }, stars: number, emoji: string, jump: string) {
  const embed: APIEmbed = {
    author: { name: message.author.username, ...(message.author.avatarURL ? { icon_url: message.author.avatarURL } : {}) },
    description: message.content.slice(0, 4000) || undefined,
    color: 0xf5c542,
    fields: [{ name: '​', value: `[${jump}](${message.url})` }],
    ...(message.image ? { image: { url: message.image } } : {}),
    timestamp: new Date(message.createdTimestamp).toISOString(),
  };
  return { content: `${emoji} **${stars}** · <#${message.channelId}>`, embeds: [embed], allowedMentions: { parse: [] } };
}

/** Counts the reactions that count: no bots, no author unless allowed. */
async function countStars(reaction: MessageReaction, authorId: string, config: StarboardConfig): Promise<number> {
  const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
  if (!users) return reaction.count ?? 0;
  return users.filter((u) => !u.bot && (config.selfStar || u.id !== authorId)).size;
}

/**
 * Whether the board may show a message of the channel: one everyone on the server can read. A staff channel, a
 * ticket or a private thread stays private, however many stars it gets.
 */
export function publicChannel(channel: GuildTextBasedChannel): boolean {
  if (channel.type === ChannelType.PrivateThread) return false;
  return channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

/**
 * A reaction came or went. Messages are not cached, so the reaction and the message need REST calls: they are made
 * only for the board's emoji, which the event carries even when partial. One update per message at a time (a Redis
 * lock across clusters): two at once would both post a copy; a reaction coming meanwhile asks the holder to run again.
 */
export async function onReaction(ctx: Ctx, rawReaction: MessageReaction | PartialMessageReaction): Promise<void> {
  const { guildId, channelId, id: messageId } = rawReaction.message;
  if (!guildId) return;
  const config = await ctx.getConfig(guildId);
  if (!config.channelId || channelId === config.channelId || !matchesEmoji(config.emoji, rawReaction.emoji)) return;

  const lock = `starboard:lock:${messageId}`;
  const again = `starboard:again:${messageId}`;
  if (!(await ctx.redis.set(lock, '1', 'PX', LOCK_MS, 'NX'))) {
    await ctx.redis.set(again, '1', 'PX', LOCK_MS);
    return;
  }
  try {
    do await updateEntry(ctx, rawReaction, config);
    while (await ctx.redis.getdel(again));
  } finally {
    await ctx.redis.del(lock);
  }
}

/** Longer than an update takes (a few REST calls), so a crashed cluster frees the message soon. */
const LOCK_MS = 15_000;

async function updateEntry(ctx: Ctx, rawReaction: MessageReaction | PartialMessageReaction, config: StarboardConfig): Promise<void> {
  const reaction = await rawReaction.fetch().catch(() => null);
  if (!reaction) return;
  const message: Message | PartialMessage = reaction.message.partial ? await reaction.message.fetch().catch(() => reaction.message) : reaction.message;
  if (message.partial || !message.inGuild() || !config.channelId) return;
  if (config.ignoredChannelIds.includes(message.channelId) || (message.channel.parentId && config.ignoredChannelIds.includes(message.channel.parentId))) return;
  if (!config.allowNsfw && 'nsfw' in message.channel && message.channel.nsfw) return;
  if (!publicChannel(message.channel)) return;

  const board = message.guild.channels.cache.get(config.channelId);
  if (!board?.isSendable()) return;
  const stars = await countStars(reaction, message.author.id, config);
  const entry = await ctx.db.starboardEntry.findUnique({ where: { messageId: message.id } });
  const locale = await ctx.guildLocales.get(message.guildId);

  if (stars < config.threshold) {
    if (entry?.starboardMessageId) await board.messages.delete(entry.starboardMessageId).catch(() => undefined);
    if (entry) await ctx.db.starboardEntry.delete({ where: { messageId: message.id } });
    return;
  }

  const image = message.attachments.find((a) => a.contentType?.startsWith('image/'))?.url ?? message.embeds.find((e) => e.image)?.image?.url ?? null;
  const body = starboardBody(
    { content: message.content, url: message.url, channelId: message.channelId, createdTimestamp: message.createdTimestamp, author: { username: message.author.username, avatarURL: message.author.displayAvatarURL({ size: 128 }) }, image },
    stars,
    config.emoji,
    ctx.i18n.t(locale, 'starboard.jump'),
  );

  if (entry?.starboardMessageId) {
    const edited = await board.messages.edit(entry.starboardMessageId, body).catch(() => null);
    if (edited) {
      await ctx.db.starboardEntry.update({ where: { messageId: message.id }, data: { stars } });
      return;
    }
  }
  const posted = await board.send(body);
  await ctx.db.starboardEntry.upsert({
    where: { messageId: message.id },
    create: { messageId: message.id, guildId: message.guildId, channelId: message.channelId, authorId: message.author.id, starboardMessageId: posted.id, stars },
    update: { starboardMessageId: posted.id, stars },
  });
}

/** The original was deleted: its copy goes too. */
export async function onMessageDelete(ctx: Ctx, message: Message | PartialMessage): Promise<void> {
  if (!message.guildId) return;
  const entry = await ctx.db.starboardEntry.findUnique({ where: { messageId: message.id } });
  if (!entry) return;
  const config = await ctx.getConfig(message.guildId);
  const board = config.channelId ? message.guild?.channels.cache.get(config.channelId) : undefined;
  if (entry.starboardMessageId && board?.isTextBased()) await board.messages.delete(entry.starboardMessageId).catch(() => undefined);
  await ctx.db.starboardEntry.delete({ where: { messageId: message.id } });
}
