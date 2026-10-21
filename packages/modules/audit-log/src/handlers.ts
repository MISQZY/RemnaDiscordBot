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

/** Who an overwrite is for, as Discord shows it in the channel settings. */
const overwriteTarget = (overwrite: { id: string; type: number }, guildId: string) =>
  overwrite.id === guildId ? '@everyone' : overwrite.type === 0 ? `<@&${overwrite.id}>` : `<@${overwrite.id}>`;

type Overwrites = { cache: ReadonlyMap<string, { id: string; type: number; allow: { bitfield: bigint; toArray(): string[] }; deny: { bitfield: bigint; toArray(): string[] } }> };

/** Overwrites added, removed or changed between two snapshots of a channel: one line per role or member. */
export function overwriteChanges(before: Overwrites, after: Overwrites, guildId: string): { field: string; before: string; after: string }[] {
  const ids = new Set([...before.cache.keys(), ...after.cache.keys()]);
  const lines: { field: string; before: string; after: string }[] = [];
  for (const id of ids) {
    const old = before.cache.get(id);
    const now = after.cache.get(id);
    const describe = (o: typeof old) => (o ? [...o.allow.toArray().map((p) => `+${p}`), ...o.deny.toArray().map((p) => `-${p}`)].join(' ') : '');
    if (old && now && old.allow.bitfield === now.allow.bitfield && old.deny.bitfield === now.deny.bitfield) continue;
    lines.push({ field: 'overwrite', before: `${overwriteTarget((old ?? now)!, guildId)}: ${describe(old) || '—'}`, after: describe(now) });
  }
  return lines;
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
  // Notes are the moderators' own; bans come from guildBanAdd.
  if (modCase.type === 'ban' || modCase.type === 'unban' || modCase.type === 'note') return;
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
      const avatarChanged = oldMember.avatar !== newMember.avatar;

      await log.send(
        embeds.memberUpdated(log.t, {
          userId: newMember.id,
          nickname: oldMember.nickname !== newMember.nickname ? { before: oldMember.nickname, after: newMember.nickname } : undefined,
          rolesAdded: [...after].filter((id) => !before.has(id)),
          rolesRemoved: [...before].filter((id) => !after.has(id)),
          timeoutUntil: oldTimeout !== newTimeout ? newTimeout : undefined,
          avatarUrl: avatarChanged ? (newMember.avatarURL({ size: 256 }) ?? null) : undefined,
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
      const changes = [...diff(read(oldChannel), read(newChannel)), ...overwriteChanges(oldChannel.permissionOverwrites, newChannel.permissionOverwrites, newChannel.guild.id)];
      await log.send(embeds.entityUpdated(log.t, { kind: 'channel', id: newChannel.id, name: newChannel.name, changes }));
    },

    threadCreate: async (ctx, thread, newlyCreated) => {
      if (!newlyCreated) return;
      const log = await prepare(ctx, thread.guild, 'server');
      if (!log || isIgnored(log.config, { channelId: thread.parentId })) return;
      await log.send(embeds.serverChanged(log.t, { kind: 'threadCreated', name: thread.name, id: thread.id, parentId: thread.parentId, authorId: thread.ownerId }));
    },

    threadDelete: async (ctx, thread) => {
      const log = await prepare(ctx, thread.guild, 'server');
      if (!log || isIgnored(log.config, { channelId: thread.parentId })) return;
      await log.send(embeds.serverChanged(log.t, { kind: 'threadDeleted', name: thread.name, id: thread.id, parentId: thread.parentId }));
    },

    threadUpdate: async (ctx, oldThread, newThread) => {
      const log = await prepare(ctx, newThread.guild, 'server');
      if (!log || isIgnored(log.config, { channelId: newThread.parentId })) return;
      const yesNo = (value: boolean | null) => log.t(value ? 'audit-log.yes' : 'audit-log.no');
      const read = (thread: typeof newThread) => ({ name: thread.name, archived: yesNo(thread.archived), locked: yesNo(thread.locked) });
      await log.send(embeds.entityUpdated(log.t, { kind: 'thread', id: newThread.id, name: newThread.name, changes: diff(read(oldThread), read(newThread)) }));
    },

    emojiCreate: async (ctx, emoji) => {
      const log = await prepare(ctx, emoji.guild, 'server');
      await log?.send(embeds.serverChanged(log.t, { kind: 'emojiCreated', name: `${emoji.toString()} :${emoji.name}:`, id: emoji.id }));
    },

    emojiDelete: async (ctx, emoji) => {
      const log = await prepare(ctx, emoji.guild, 'server');
      await log?.send(embeds.serverChanged(log.t, { kind: 'emojiDeleted', name: `:${emoji.name}:`, id: emoji.id }));
    },

    emojiUpdate: async (ctx, oldEmoji, newEmoji) => {
      const log = await prepare(ctx, newEmoji.guild, 'server');
      await log?.send(embeds.entityUpdated(log.t, { kind: 'emoji', id: newEmoji.id, name: newEmoji.toString(), changes: diff({ name: oldEmoji.name ?? '' }, { name: newEmoji.name ?? '' }) }));
    },

    stickerCreate: async (ctx, sticker) => {
      if (!sticker.guild) return;
      const log = await prepare(ctx, sticker.guild, 'server');
      await log?.send(embeds.serverChanged(log.t, { kind: 'stickerCreated', name: sticker.name, id: sticker.id }));
    },

    stickerDelete: async (ctx, sticker) => {
      if (!sticker.guild) return;
      const log = await prepare(ctx, sticker.guild, 'server');
      await log?.send(embeds.serverChanged(log.t, { kind: 'stickerDeleted', name: sticker.name, id: sticker.id }));
    },

    stickerUpdate: async (ctx, oldSticker, newSticker) => {
      if (!newSticker.guild) return;
      const log = await prepare(ctx, newSticker.guild, 'server');
      const read = (s: typeof newSticker) => ({ name: s.name, description: s.description ?? '', tags: s.tags ?? '' });
      await log?.send(embeds.entityUpdated(log.t, { kind: 'sticker', id: newSticker.id, name: newSticker.name, changes: diff(read(oldSticker), read(newSticker)) }));
    },

    webhooksUpdate: async (ctx, channel) => {
      const log = await prepare(ctx, channel.guild, 'server');
      if (!log || isIgnored(log.config, { channelId: channel.id })) return;
      await log.send(embeds.webhooksUpdated(log.t, { channelId: channel.id }));
    },

    guildUpdate: async (ctx, oldGuild, newGuild) => {
      const log = await prepare(ctx, newGuild, 'server');
      if (!log) return;
      const channelOf = (id: string | null) => (id ? `<#${id}>` : '');
      const read = (guild: typeof newGuild) => ({
        name: guild.name,
        icon: guild.icon ?? '',
        verificationLevel: String(guild.verificationLevel),
        explicitContentFilter: String(guild.explicitContentFilter),
        mfaLevel: String(guild.mfaLevel),
        vanityCode: guild.vanityURLCode ?? '',
        systemChannel: channelOf(guild.systemChannelId),
        rulesChannel: channelOf(guild.rulesChannelId),
        afkChannel: channelOf(guild.afkChannelId),
        owner: guild.ownerId ? `<@${guild.ownerId}>` : '',
      });
      await log.send(embeds.entityUpdated(log.t, { kind: 'guild', id: newGuild.id, name: newGuild.name, changes: diff(read(oldGuild), read(newGuild)) }));
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

    inviteDelete: async (ctx, invite) => {
      const guild = invite.guild && 'channels' in invite.guild ? invite.guild : null;
      if (!guild) return;
      const log = await prepare(ctx, guild, 'server');
      if (!log || isIgnored(log.config, { channelId: invite.channelId })) return;
      await log.send(embeds.serverChanged(log.t, { kind: 'inviteDeleted', name: `discord.gg/${invite.code}`, id: invite.code, parentId: invite.channelId }));
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
