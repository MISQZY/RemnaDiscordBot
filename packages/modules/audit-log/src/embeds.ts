import type { APIEmbed } from 'discord.js';

/** Builds log entries from plain data — without discord.js, so they are easy to test. */

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const COLOR = { create: 0x3ba55d, update: 0x5865f2, delete: 0xd83c3e, neutral: 0x99aab5 } as const;

const user = (id: string) => `<@${id}> (\`${id}\`)`;
const channel = (id: string) => `<#${id}>`;
const time = (ms: number, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const quote = (text: string, empty: string) => (text.trim() ? text.slice(0, 1000) : `*${empty}*`);

export function messageDeleted(
  t: Translate,
  data: { authorId: string | null; channelId: string; content: string | null; attachments: string[]; createdAt: number | null },
): APIEmbed {
  return {
    title: t('audit-log.messages.deleted'),
    color: COLOR.delete,
    fields: [
      { name: t('audit-log.fields.author'), value: data.authorId ? user(data.authorId) : t('audit-log.unknown'), inline: true },
      { name: t('audit-log.fields.channel'), value: channel(data.channelId), inline: true },
      ...(data.createdAt ? [{ name: t('audit-log.fields.sent'), value: time(data.createdAt), inline: true }] : []),
      { name: t('audit-log.fields.content'), value: data.content === null ? `*${t('audit-log.notCached')}*` : quote(data.content, t('audit-log.empty')) },
      ...(data.attachments.length > 0 ? [{ name: t('audit-log.fields.attachments'), value: data.attachments.join('\n').slice(0, 1024) }] : []),
    ],
    timestamp: new Date().toISOString(),
  };
}

export function messageEdited(
  t: Translate,
  data: { authorId: string; channelId: string; url: string; before: string | null; after: string },
): APIEmbed {
  return {
    title: t('audit-log.messages.edited'),
    url: data.url,
    color: COLOR.update,
    fields: [
      { name: t('audit-log.fields.author'), value: user(data.authorId), inline: true },
      { name: t('audit-log.fields.channel'), value: channel(data.channelId), inline: true },
      { name: t('audit-log.fields.before'), value: data.before === null ? `*${t('audit-log.notCached')}*` : quote(data.before, t('audit-log.empty')) },
      { name: t('audit-log.fields.after'), value: quote(data.after, t('audit-log.empty')) },
    ],
    timestamp: new Date().toISOString(),
  };
}

export function messagesPurged(t: Translate, data: { channelId: string; count: number }): APIEmbed {
  return {
    title: t('audit-log.messages.purged', { count: data.count }),
    color: COLOR.delete,
    fields: [{ name: t('audit-log.fields.channel'), value: channel(data.channelId), inline: true }],
    timestamp: new Date().toISOString(),
  };
}

export function memberJoined(t: Translate, data: { userId: string; username: string; createdAt: number }): APIEmbed {
  const ageDays = Math.floor((Date.now() - data.createdAt) / 86_400_000);
  return {
    title: t('audit-log.members.joined'),
    color: COLOR.create,
    description: `${user(data.userId)} · **${data.username}**`,
    fields: [
      { name: t('audit-log.fields.accountCreated'), value: time(data.createdAt), inline: true },
      ...(ageDays < 7 ? [{ name: '⚠️', value: t('audit-log.members.newAccount'), inline: true }] : []),
    ],
    timestamp: new Date().toISOString(),
  };
}

export function memberLeft(t: Translate, data: { userId: string; username: string; joinedAt: number | null; roleIds: string[] }): APIEmbed {
  return {
    title: t('audit-log.members.left'),
    color: COLOR.delete,
    description: `${user(data.userId)} · **${data.username}**`,
    fields: [
      ...(data.joinedAt ? [{ name: t('audit-log.fields.joined'), value: time(data.joinedAt), inline: true }] : []),
      ...(data.roleIds.length > 0 ? [{ name: t('audit-log.fields.roles'), value: data.roleIds.map((id) => `<@&${id}>`).join(' ').slice(0, 1024) }] : []),
    ],
    timestamp: new Date().toISOString(),
  };
}

export function memberUpdated(
  t: Translate,
  data: {
    userId: string;
    nickname?: { before: string | null; after: string | null };
    rolesAdded: string[];
    rolesRemoved: string[];
    timeoutUntil?: number | null;
    /** The server avatar changed: the new one, `null` when it was removed. */
    avatarUrl?: string | null;
  },
): APIEmbed | null {
  const fields: NonNullable<APIEmbed['fields']> = [];
  if (data.nickname) {
    fields.push({
      name: t('audit-log.fields.nickname'),
      value: `${data.nickname.before ?? '—'} → ${data.nickname.after ?? '—'}`,
    });
  }
  if (data.rolesAdded.length > 0) fields.push({ name: t('audit-log.fields.rolesAdded'), value: data.rolesAdded.map((id) => `<@&${id}>`).join(' ') });
  if (data.rolesRemoved.length > 0) fields.push({ name: t('audit-log.fields.rolesRemoved'), value: data.rolesRemoved.map((id) => `<@&${id}>`).join(' ') });
  if (data.timeoutUntil !== undefined) {
    fields.push({ name: t('audit-log.fields.timeout'), value: data.timeoutUntil ? time(data.timeoutUntil, 'f') : t('audit-log.members.timeoutRemoved') });
  }
  if (data.avatarUrl !== undefined) fields.push({ name: t('audit-log.fields.serverAvatar'), value: data.avatarUrl ?? t('audit-log.members.avatarRemoved') });
  if (fields.length === 0) return null;
  return {
    title: t('audit-log.members.updated'),
    color: COLOR.update,
    description: user(data.userId),
    fields,
    ...(data.avatarUrl ? { thumbnail: { url: data.avatarUrl } } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function voiceChanged(t: Translate, data: { userId: string; from: string | null; to: string | null }): APIEmbed | null {
  if (data.from === data.to) return null;
  const [title, color] = !data.from
    ? [t('audit-log.voice.joined'), COLOR.create]
    : !data.to
      ? [t('audit-log.voice.left'), COLOR.delete]
      : [t('audit-log.voice.moved'), COLOR.update];
  return {
    title,
    color,
    description: [user(data.userId), data.from && channel(data.from), data.to && channel(data.to)].filter(Boolean).join(' → '),
    timestamp: new Date().toISOString(),
  };
}

export type ServerChange =
  | 'channelCreated'
  | 'channelDeleted'
  | 'roleCreated'
  | 'roleDeleted'
  | 'threadCreated'
  | 'threadDeleted'
  | 'emojiCreated'
  | 'emojiDeleted'
  | 'stickerCreated'
  | 'stickerDeleted'
  | 'inviteDeleted';

export function serverChanged(t: Translate, data: { kind: ServerChange; name: string; id: string; parentId?: string | null; authorId?: string | null }): APIEmbed {
  const created = data.kind.endsWith('Created');
  return {
    title: t(`audit-log.server.${data.kind}`),
    color: created ? COLOR.create : COLOR.delete,
    description: `**${data.name}** (\`${data.id}\`)`,
    fields: [
      ...(data.parentId ? [{ name: t('audit-log.fields.channel'), value: channel(data.parentId), inline: true }] : []),
      ...(data.authorId ? [{ name: t('audit-log.fields.author'), value: user(data.authorId), inline: true }] : []),
    ],
    timestamp: new Date().toISOString(),
  };
}

/** The webhooks of a channel changed: Discord does not say which, only where. */
export function webhooksUpdated(t: Translate, data: { channelId: string }): APIEmbed {
  return {
    title: t('audit-log.server.webhooksUpdated'),
    color: COLOR.update,
    description: channel(data.channelId),
    timestamp: new Date().toISOString(),
  };
}

/** A before → after line per changed property; `null` when nothing visible changed. */
export function entityUpdated(
  t: Translate,
  data: { kind: 'channel' | 'role' | 'thread' | 'emoji' | 'sticker' | 'guild'; id: string; name: string; changes: { field: string; before: string; after: string }[] },
): APIEmbed | null {
  if (data.changes.length === 0) return null;
  const mention = data.kind === 'channel' || data.kind === 'thread' ? channel(data.id) : data.kind === 'role' ? `<@&${data.id}>` : `\`${data.id}\``;
  return {
    title: t(`audit-log.server.${data.kind}Updated`),
    color: COLOR.update,
    description: `${mention} · **${data.name}**`,
    fields: data.changes.map((c) => ({ name: t(`audit-log.changes.${c.field}`), value: `${c.before || '—'} → ${c.after || '—'}`.slice(0, 1024) })),
    timestamp: new Date().toISOString(),
  };
}

export function inviteCreated(
  t: Translate,
  data: { code: string; channelId: string | null; inviterId: string | null; maxUses: number | null; expiresAt: number | null },
): APIEmbed {
  return {
    title: t('audit-log.server.inviteCreated'),
    color: COLOR.create,
    description: `discord.gg/${data.code}`,
    fields: [
      { name: t('audit-log.fields.author'), value: data.inviterId ? user(data.inviterId) : t('audit-log.unknown'), inline: true },
      ...(data.channelId ? [{ name: t('audit-log.fields.channel'), value: channel(data.channelId), inline: true }] : []),
      { name: t('audit-log.fields.maxUses'), value: data.maxUses ? String(data.maxUses) : '∞', inline: true },
      { name: t('audit-log.fields.expires'), value: data.expiresAt ? time(data.expiresAt) : t('audit-log.never'), inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
}

/** A case of the bot's moderation commands (`moderation.caseCreated`). */
export function caseCreated(
  t: Translate,
  data: { number: number; type: string; targetId: string; moderatorId: string; reason: string | null; expiresAt: string | null },
): APIEmbed {
  const moderator = /^\d+$/.test(data.moderatorId) ? user(data.moderatorId) : t('audit-log.moderation.system');
  return {
    title: t('audit-log.moderation.case', { number: data.number, action: t(`audit-log.moderation.actions.${data.type}`) }),
    color: ['unban', 'unmute'].includes(data.type) ? COLOR.create : COLOR.delete,
    fields: [
      { name: t('audit-log.fields.member'), value: user(data.targetId), inline: true },
      { name: t('audit-log.fields.moderator'), value: moderator, inline: true },
      ...(data.expiresAt ? [{ name: t('audit-log.fields.until'), value: time(Date.parse(data.expiresAt), 'f'), inline: true }] : []),
      { name: t('audit-log.fields.reason'), value: data.reason?.slice(0, 1024) || t('audit-log.moderation.noReason') },
    ],
    timestamp: new Date().toISOString(),
  };
}

export function banChanged(t: Translate, data: { userId: string; username: string; banned: boolean; reason: string | null }): APIEmbed {
  return {
    title: t(data.banned ? 'audit-log.moderation.banned' : 'audit-log.moderation.unbanned'),
    color: data.banned ? COLOR.delete : COLOR.create,
    description: `${user(data.userId)} · **${data.username}**`,
    fields: data.reason ? [{ name: t('audit-log.fields.reason'), value: data.reason.slice(0, 1024) }] : [],
    timestamp: new Date().toISOString(),
  };
}
