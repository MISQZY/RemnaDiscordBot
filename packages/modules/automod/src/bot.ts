import type { BotModuleContext } from '@bot/core';
import { createHash } from 'node:crypto';
import { DiscordAPIError, PermissionFlagsBits, Routes, type APIEmbed, type GuildMember, type Message, type PartialMessage } from 'discord.js';
import type { AutomodConfig, FilterName } from './config.js';
import { inviteCodes, staticViolation } from './filters.js';
import { punish } from './punish.js';
import { recordInWindow } from './window.js';

type Ctx = BotModuleContext<AutomodConfig>;

export interface Violation {
  filter: FilterName;
  /** What was found: the word, the links, the count. */
  detail: string;
  /** Recent messages of the burst (spam), to delete with the current one: `channelId:messageId`. */
  burst?: string[];
}

const keys = {
  spam: (guildId: string, userId: string) => `automod:spam:${guildId}:${userId}`,
  duplicate: (guildId: string, userId: string, hash: string) => `automod:dup:${guildId}:${userId}:${hash}`,
  hit: (guildId: string, userId: string, filter: string) => `automod:hit:${guildId}:${userId}:${filter}`,
  invite: (code: string) => `automod:invite:${code}`,
};

/** Moderators and the exemptions of the module and of the filter are not checked. */
export function isExempt(
  config: Pick<AutomodConfig, 'exemptRoleIds' | 'exemptChannelIds'>,
  scope: { exemptRoleIds: string[]; exemptChannelIds: string[] } | null,
  { roleIds, channelIds, moderator }: { roleIds: readonly string[]; channelIds: readonly string[]; moderator: boolean },
): boolean {
  if (moderator) return true;
  const roles = [...config.exemptRoleIds, ...(scope?.exemptRoleIds ?? [])];
  const channels = [...config.exemptChannelIds, ...(scope?.exemptChannelIds ?? [])];
  return roleIds.some((id) => roles.includes(id)) || channelIds.some((id) => channels.includes(id));
}

/** The guild an invite leads to, cached for a day; `null` when Discord does not know the code. */
async function inviteGuild(ctx: Ctx, code: string): Promise<string | null> {
  const cached = await ctx.redis.get(keys.invite(code));
  if (cached !== null) return cached || null;
  let guildId = '';
  try {
    const invite = (await ctx.rest.get(Routes.invite(code))) as { guild?: { id: string } };
    guildId = invite.guild?.id ?? '';
  } catch (err) {
    if (!(err instanceof DiscordAPIError)) throw err;
  }
  await ctx.redis.set(keys.invite(code), guildId, 'EX', 86_400);
  return guildId || null;
}

/** Messages within the window, the current one included; over the limit — the burst to delete. */
async function spamBurst(ctx: Ctx, message: Message<true>, filter: AutomodConfig['filters']['spam']): Promise<string[] | null> {
  const key = keys.spam(message.guildId, message.author.id);
  const members = await recordInWindow(ctx.redis, key, `${message.channelId}:${message.id}`, { limit: filter.messages, windowMs: filter.seconds * 1000 });
  if (members.length < filter.messages) return null;
  await ctx.redis.del(key);
  return members;
}

async function isDuplicate(ctx: Ctx, message: Message<true>, filter: AutomodConfig['filters']['duplicates']): Promise<boolean> {
  const text = message.content.trim().toLowerCase();
  if (text.length < 3) return false;
  const key = keys.duplicate(message.guildId, message.author.id, createHash('sha1').update(text).digest('base64url').slice(0, 16));
  // The window's TTL comes with the key in one step: a crash between INCR and EXPIRE would leave it forever.
  const results = await ctx.redis.multi().set(key, 0, 'EX', filter.seconds, 'NX').incr(key).exec();
  return Number(results?.[1]?.[1] ?? 0) >= filter.count;
}

/** The first filter the message breaks. */
export async function findViolation(ctx: Ctx, message: Message<true>, member: GuildMember, config: AutomodConfig): Promise<Violation | null> {
  const roleIds = [...member.roles.cache.keys()];
  const channelIds = [message.channelId, message.channel.parentId].filter((id): id is string => Boolean(id));
  const moderator = member.permissions.has(PermissionFlagsBits.ManageMessages);
  if (isExempt(config, null, { roleIds, channelIds, moderator })) return null;
  const applies = (name: FilterName) => config.filters[name].enabled && !isExempt(config, config.filters[name], { roleIds, channelIds, moderator });

  if (applies('invites')) {
    const codes = inviteCodes(message.content);
    for (const code of codes) {
      if (!config.filters.invites.allowOwnServer || (await inviteGuild(ctx, code)) !== message.guildId) return { filter: 'invites', detail: code };
    }
  }

  const mentions = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
  const found = staticViolation(config.filters, { content: message.content, mentions }, applies);
  if (found) return found;

  if (applies('spam')) {
    const burst = await spamBurst(ctx, message, config.filters.spam);
    if (burst) return { filter: 'spam', detail: String(burst.length), burst };
  }
  if (applies('duplicates') && (await isDuplicate(ctx, message, config.filters.duplicates))) return { filter: 'duplicates', detail: message.content.slice(0, 100) };
  return null;
}

async function translator(ctx: Ctx, guildId: string) {
  const locale = await ctx.guildLocales.get(guildId);
  return (key: string, vars?: Record<string, string | number>) => ctx.i18n.t(locale, key, vars);
}

async function deleteBurst(message: Message<true>, burst: readonly string[]): Promise<void> {
  const byChannel = new Map<string, string[]>();
  for (const item of burst) {
    const [channelId, messageId] = item.split(':');
    if (channelId && messageId) byChannel.set(channelId, [...(byChannel.get(channelId) ?? []), messageId]);
  }
  for (const [channelId, ids] of byChannel) {
    const channel = message.guild.channels.cache.get(channelId);
    if (channel?.isTextBased()) await channel.bulkDelete(ids, true).catch(() => undefined);
  }
}

/** Deletes, warns in the channel, punishes once per burst and logs. */
export async function enforce(ctx: Ctx, message: Message<true>, member: GuildMember, config: AutomodConfig, violation: Violation): Promise<void> {
  const action = config.filters[violation.filter].action;
  const t = await translator(ctx, message.guildId);
  const filterName = t(`automod.filters.${violation.filter}`);

  if (action.delete) {
    if (violation.burst) await deleteBurst(message, violation.burst);
    else await message.delete().catch(() => undefined);
  }

  // A burst of messages breaking the same filter gets one punishment and one log entry.
  const first = await ctx.redis.set(keys.hit(message.guildId, member.id, violation.filter), '1', 'EX', 30, 'NX');
  if (!first) return;

  if (config.notifyInChannel && action.delete && message.channel.isSendable()) {
    const notice = await message.channel
      .send({ content: t('automod.notice', { user: `<@${member.id}>`, filter: filterName }), allowedMentions: { users: [member.id] } })
      .catch(() => null);
    if (notice) setTimeout(() => void notice.delete().catch(() => undefined), 6_000).unref();
  }

  const punished = await punish(ctx, member, action.punishment, { reason: t('automod.reason', { filter: filterName }), durationSec: action.muteSec });

  if (!config.logChannelId) return;
  const log = message.guild.channels.cache.get(config.logChannelId);
  if (!log?.isSendable()) return;
  const embed: APIEmbed = {
    title: t('automod.log.title', { filter: filterName }),
    color: 0xf0a020,
    fields: [
      { name: t('automod.log.member'), value: `<@${member.id}> (\`${member.id}\`)`, inline: true },
      { name: t('automod.log.channel'), value: `<#${message.channelId}>`, inline: true },
      { name: t('automod.log.found'), value: violation.detail.slice(0, 1024) || '—', inline: true },
      {
        name: t('automod.log.action'),
        value: [action.delete ? t('automod.log.deleted') : null, punished ? t(`automod.punishments.${action.punishment}`) : null].filter(Boolean).join(' · ') || '—',
      },
      ...(message.content ? [{ name: t('automod.log.content'), value: message.content.slice(0, 1024) }] : []),
    ],
    timestamp: new Date().toISOString(),
  };
  await log.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

/** Who the honeypot leaves alone: the owner and anyone who moderates messages (bots never get here). */
export function isSpared(member: { id: string; permissions: { has(permission: bigint): boolean }; guild: { ownerId: string } }): boolean {
  return member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageMessages);
}

/** A message in the honeypot channel: deleted, and its author punished at once — one punishment for a burst. */
async function honeypot(ctx: Ctx, message: Message<true>, member: GuildMember, config: AutomodConfig): Promise<void> {
  await message.delete().catch(() => undefined);
  if (!(await ctx.redis.set(`automod:honeypot:${message.guildId}:${member.id}`, '1', 'EX', 60, 'NX'))) return;
  const t = await translator(ctx, message.guildId);
  const { action, deleteHours, muteSec } = config.honeypot;
  const punished = await punish(ctx, member, action, { reason: t('automod.honeypot.reason'), durationSec: muteSec, deleteMessageSeconds: deleteHours * 3600 });
  if (!punished) ctx.logger.warn({ guildId: message.guildId, userId: member.id }, 'Honeypot: the bot could not punish this member');
}

export async function onMessage(ctx: Ctx, message: Message | PartialMessage): Promise<void> {
  if (message.partial || !message.inGuild() || message.author.bot || message.system || message.webhookId) return;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;
  const config = await ctx.getConfig(message.guildId);
  if (config.honeypot.channelId && message.channelId === config.honeypot.channelId) {
    if (!isSpared(member)) await honeypot(ctx, message, member, config);
    return;
  }
  const violation = await findViolation(ctx, message, member, config);
  if (violation) await enforce(ctx, message, member, config, violation);
}

/** An edit is checked again, but not counted toward spam or duplicates. */
export async function onMessageEdit(ctx: Ctx, oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> {
  if (newMessage.partial || oldMessage.content === newMessage.content) return;
  if (!newMessage.inGuild() || newMessage.author.bot) return;
  const member = newMessage.member;
  if (!member) return;
  const config = await ctx.getConfig(newMessage.guildId);
  const withoutRate = { ...config, filters: { ...config.filters, spam: { ...config.filters.spam, enabled: false }, duplicates: { ...config.filters.duplicates, enabled: false } } };
  const violation = await findViolation(ctx, newMessage, member, withoutRate);
  if (violation) await enforce(ctx, newMessage, member, config, violation);
}
