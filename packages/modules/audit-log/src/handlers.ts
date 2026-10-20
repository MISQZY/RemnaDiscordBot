import type { BotModuleContext, EventHandlers } from '@bot/core';
import type { ModCaseDto } from '@bot/module-moderation';
import type { APIEmbed, Guild, GuildMember, PartialGuildMember } from 'discord.js';
import type { AuditLogConfig, LogCategory } from './config.js';
import * as embeds from './embeds.js';
import { MessageCache } from './message-cache.js';

type Ctx = BotModuleContext<AuditLogConfig>;

async function translator(ctx: Ctx, guildId: string): Promise<embeds.Translate> {
  const locale = await ctx.guildLocales.get(guildId);
  return (key, vars) => ctx.i18n.t(locale, key, vars);
}

function isIgnored(config: AuditLogConfig, { channelId, member, bot }: { channelId?: string | null; member?: GuildMember | PartialGuildMember | null; bot?: boolean }) {
  if (bot && config.ignoreBots) return true;
  if (channelId && config.ignoredChannelIds.includes(channelId)) return true;
  return member?.roles?.cache?.some((role) => config.ignoredRoleIds.includes(role.id)) ?? false;
}

/** Prepares config, translation and sending for a category; `null` — the category is not configured. */
async function prepare(ctx: Ctx, guild: Guild, category: LogCategory) {
  const config = await ctx.getConfig(guild.id);
  const channelId = config.channels[category];
  if (!channelId) return null;

  const t = await translator(ctx, guild.id);
  const send = async (embed: APIEmbed | null) => {
    if (!embed) return;
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.isSendable()) {
      ctx.logger.warn({ guildId: guild.id, channelId, category }, 'Audit log channel is missing or not writable');
      return;
    }
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  };
  return { config, t, send };
}

/** Properties whose text differs between two snapshots. */
function diff<T extends Record<string, string>>(before: T, after: T): { field: string; before: string; after: string }[] {
  return Object.keys(after)
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field]!, after: after[field]! }));
}

/**
 * Cases of the bot's own moderation commands. Bans are already logged from `guildBanAdd`;
 * kicks, mutes and warnings have no event of their own in this category.
 */
export async function onCaseCreated(ctx: Ctx, { guildId, case: modCase }: { guildId: string; case: ModCaseDto }): Promise<void> {
  if (modCase.type === 'ban' || modCase.type === 'unban') return;
  if (!(await ctx.config.isEnabled(guildId, ctx.moduleId))) return;
  const guild = ctx.client.guilds.cache.get(guildId);
  if (!guild) return;
  const log = await prepare(ctx, guild, 'moderation');
  await log?.send(embeds.caseCreated(log.t, modCase));
}

export function createHandlers(): EventHandlers<AuditLogConfig> {
  return {
    messageCreate: async (ctx, message) => {
      if (!message.inGuild()) return;
      const config = await ctx.getConfig(message.guildId);
      if (!config.channels.messages || isIgnored(config, { channelId: message.channelId, member: message.member, bot: message.author.bot })) return;
      await new MessageCache(ctx.redis).set(message.id, {
        authorId: message.author.id,
        channelId: message.channelId,
        content: message.content,
        attachments: [...message.attachments.values()].map((a) => a.url),
        createdAt: message.createdTimestamp,
      });
    },

    messageDelete: async (ctx, message) => {
      if (!message.guild) return;
      const log = await prepare(ctx, message.guild, 'messages');
      if (!log) return;
      const cache = new MessageCache(ctx.redis);
      const cached = await cache.get(message.id);
      if (isIgnored(log.config, { channelId: message.channelId, member: message.member, bot: message.author?.bot })) return;
      await cache.delete(message.id);

      await log.send(
        embeds.messageDeleted(log.t, {
          authorId: cached?.authorId ?? message.author?.id ?? null,
          channelId: message.channelId,
          content: cached?.content ?? message.content ?? null,
          attachments: cached?.attachments ?? [],
          createdAt: cached?.createdAt ?? message.createdTimestamp ?? null,
        }),
      );
    },

    messageDeleteBulk: async (ctx, messages, channel) => {
      const log = await prepare(ctx, channel.guild, 'messages');
      if (!log || isIgnored(log.config, { channelId: channel.id })) return;
      await log.send(embeds.messagesPurged(log.t, { channelId: channel.id, count: messages.size }));
    },

    messageUpdate: async (ctx, oldMessage, newMessage) => {
      if (!newMessage.guild || newMessage.content === null) return;
      const log = await prepare(ctx, newMessage.guild, 'messages');
      if (!log) return;
      const authorId = newMessage.author?.id;
      if (!authorId || isIgnored(log.config, { channelId: newMessage.channelId, member: newMessage.member, bot: newMessage.author?.bot })) return;

      const cache = new MessageCache(ctx.redis);
      const cached = await cache.get(newMessage.id);
      const before = cached?.content ?? oldMessage.content ?? null;
      // Discord also sends updates when link previews load — the text stays the same.
      if (before === newMessage.content) return;

      if (cached) await cache.set(newMessage.id, { ...cached, content: newMessage.content });
      await log.send(
        embeds.messageEdited(log.t, { authorId, channelId: newMessage.channelId, url: newMessage.url, before, after: newMessage.content }),
      );
    },

    guildMemberAdd: async (ctx, member) => {
      const log = await prepare(ctx, member.guild, 'members');
      if (!log || isIgnored(log.config, { bot: member.user.bot })) return;
      await log.send(embeds.memberJoined(log.t, { userId: member.id, username: member.user.username, createdAt: member.user.createdTimestamp }));
    },

    guildMemberRemove: async (ctx, member) => {
      const log = await prepare(ctx, member.guild, 'members');
      if (!log || isIgnored(log.config, { bot: member.user.bot })) return;
      await log.send(
        embeds.memberLeft(log.t, {
          userId: member.id,
          username: member.user.username,
          joinedAt: member.joinedTimestamp,
          roleIds: member.partial ? [] : member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.id),
        }),
      );
    },

    guildMemberUpdate: async (ctx, oldMember, newMember) => {
      const log = await prepare(ctx, newMember.guild, 'members');
      if (!log || isIgnored(log.config, { member: newMember, bot: newMember.user.bot })) return;
      // Without the old state (partial) changes cannot be computed.
      if (oldMember.partial) return;

      const before = new Set(oldMember.roles.cache.keys());
      const after = new Set(newMember.roles.cache.keys());
      const oldTimeout = oldMember.communicationDisabledUntilTimestamp ?? null;
      const newTimeout = newMember.communicationDisabledUntilTimestamp ?? null;

      await log.send(
        embeds.memberUpdated(log.t, {
          userId: newMember.id,
          nickname: oldMember.nickname !== newMember.nickname ? { before: oldMember.nickname, after: newMember.nickname } : undefined,
          rolesAdded: [...after].filter((id) => !before.has(id)),
          rolesRemoved: [...before].filter((id) => !after.has(id)),
          timeoutUntil: oldTimeout !== newTimeout ? newTimeout : undefined,
        }),
      );
    },

    voiceStateUpdate: async (ctx, oldState, newState) => {
      const log = await prepare(ctx, newState.guild, 'voice');
      if (!log || isIgnored(log.config, { member: newState.member, bot: newState.member?.user.bot })) return;
      await log.send(embeds.voiceChanged(log.t, { userId: newState.id, from: oldState.channelId, to: newState.channelId }));
    },

    channelCreate: async (ctx, channel) => {
      const log = await prepare(ctx, channel.guild, 'server');
      await log?.send(embeds.serverChanged(log.t, { kind: 'channelCreated', name: channel.name, id: channel.id }));
    },

    channelDelete: async (ctx, channel) => {
      if (channel.isDMBased()) return;
      const log = await prepare(ctx, channel.guild, 'server');
      await log?.send(embeds.serverChanged(log.t, { kind: 'channelDeleted', name: channel.name, id: channel.id }));
    },

    channelUpdate: async (ctx, oldChannel, newChannel) => {
      if (oldChannel.isDMBased() || newChannel.isDMBased()) return;
      const log = await prepare(ctx, newChannel.guild, 'server');
      if (!log || isIgnored(log.config, { channelId: newChannel.id })) return;
      const yesNo = (value: boolean) => log.t(value ? 'audit-log.yes' : 'audit-log.no');
      const read = (channel: typeof newChannel) => ({
        name: channel.name,
        topic: 'topic' in channel ? (channel.topic ?? '') : '',
        nsfw: 'nsfw' in channel ? yesNo(channel.nsfw) : '',
        slowmode: 'rateLimitPerUser' in channel ? `${channel.rateLimitPerUser ?? 0} s` : '',
        parent: channel.parentId ? `<#${channel.parentId}>` : '',
      });
      await log.send(embeds.entityUpdated(log.t, { kind: 'channel', id: newChannel.id, name: newChannel.name, changes: diff(read(oldChannel), read(newChannel)) }));
    },

    roleCreate: async (ctx, role) => {
      const log = await prepare(ctx, role.guild, 'server');
      await log?.send(embeds.serverChanged(log.t, { kind: 'roleCreated', name: role.name, id: role.id }));
    },

    roleDelete: async (ctx, role) => {
      const log = await prepare(ctx, role.guild, 'server');
      await log?.send(embeds.serverChanged(log.t, { kind: 'roleDeleted', name: role.name, id: role.id }));
    },

    roleUpdate: async (ctx, oldRole, newRole) => {
      const log = await prepare(ctx, newRole.guild, 'server');
      if (!log) return;
      const yesNo = (value: boolean) => log.t(value ? 'audit-log.yes' : 'audit-log.no');
      const hex = (color: number) => (color ? `#${color.toString(16).padStart(6, '0')}` : '');
      const read = (role: typeof newRole) => ({ name: role.name, color: hex(role.color), hoist: yesNo(role.hoist), mentionable: yesNo(role.mentionable) });
      const changes = diff(read(oldRole), read(newRole));
      const before = new Set(oldRole.permissions.toArray());
      const after = new Set(newRole.permissions.toArray());
      const added = [...after].filter((p) => !before.has(p));
      const removed = [...before].filter((p) => !after.has(p));
      if (added.length > 0) changes.push({ field: 'permissionsAdded', before: '', after: added.join(', ') });
      if (removed.length > 0) changes.push({ field: 'permissionsRemoved', before: removed.join(', '), after: '' });
      await log.send(embeds.entityUpdated(log.t, { kind: 'role', id: newRole.id, name: newRole.name, changes }));
    },

    inviteCreate: async (ctx, invite) => {
      const guild = invite.guild && 'channels' in invite.guild ? invite.guild : null;
      if (!guild) return;
      const log = await prepare(ctx, guild, 'server');
      if (!log || isIgnored(log.config, { channelId: invite.channelId, bot: invite.inviter?.bot })) return;
      await log.send(
        embeds.inviteCreated(log.t, {
          code: invite.code,
          channelId: invite.channelId,
          inviterId: invite.inviterId,
          maxUses: invite.maxUses || null,
          expiresAt: invite.expiresTimestamp,
        }),
      );
    },

    guildBanAdd: async (ctx, ban) => {
      const log = await prepare(ctx, ban.guild, 'moderation');
      await log?.send(embeds.banChanged(log.t, { userId: ban.user.id, username: ban.user.username, banned: true, reason: ban.reason ?? null }));
    },

    guildBanRemove: async (ctx, ban) => {
      const log = await prepare(ctx, ban.guild, 'moderation');
      await log?.send(embeds.banChanged(log.t, { userId: ban.user.id, username: ban.user.username, banned: false, reason: null }));
    },
  };
}
