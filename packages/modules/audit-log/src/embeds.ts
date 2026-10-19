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
    title: t('auditLog.messages.deleted'),
    color: COLOR.delete,
    fields: [
      { name: t('auditLog.fields.author'), value: data.authorId ? user(data.authorId) : t('auditLog.unknown'), inline: true },
      { name: t('auditLog.fields.channel'), value: channel(data.channelId), inline: true },
      ...(data.createdAt ? [{ name: t('auditLog.fields.sent'), value: time(data.createdAt), inline: true }] : []),
      { name: t('auditLog.fields.content'), value: data.content === null ? `*${t('auditLog.notCached')}*` : quote(data.content, t('auditLog.empty')) },
      ...(data.attachments.length > 0 ? [{ name: t('auditLog.fields.attachments'), value: data.attachments.join('\n').slice(0, 1024) }] : []),
    ],
    timestamp: new Date().toISOString(),
  };
}

export function messageEdited(
  t: Translate,
  data: { authorId: string; channelId: string; url: string; before: string | null; after: string },
): APIEmbed {
  return {
    title: t('auditLog.messages.edited'),
    url: data.url,
    color: COLOR.update,
    fields: [
      { name: t('auditLog.fields.author'), value: user(data.authorId), inline: true },
      { name: t('auditLog.fields.channel'), value: channel(data.channelId), inline: true },
      { name: t('auditLog.fields.before'), value: data.before === null ? `*${t('auditLog.notCached')}*` : quote(data.before, t('auditLog.empty')) },
      { name: t('auditLog.fields.after'), value: quote(data.after, t('auditLog.empty')) },
    ],
    timestamp: new Date().toISOString(),
  };
}

export function messagesPurged(t: Translate, data: { channelId: string; count: number }): APIEmbed {
  return {
    title: t('auditLog.messages.purged', { count: data.count }),
    color: COLOR.delete,
    fields: [{ name: t('auditLog.fields.channel'), value: channel(data.channelId), inline: true }],
    timestamp: new Date().toISOString(),
  };
}

export function memberJoined(t: Translate, data: { userId: string; username: string; createdAt: number }): APIEmbed {
  const ageDays = Math.floor((Date.now() - data.createdAt) / 86_400_000);
  return {
    title: t('auditLog.members.joined'),
    color: COLOR.create,
    description: `${user(data.userId)} · **${data.username}**`,
    fields: [
      { name: t('auditLog.fields.accountCreated'), value: time(data.createdAt), inline: true },
      ...(ageDays < 7 ? [{ name: '⚠️', value: t('auditLog.members.newAccount'), inline: true }] : []),
    ],
    timestamp: new Date().toISOString(),
  };
}

export function memberLeft(t: Translate, data: { userId: string; username: string; joinedAt: number | null; roleIds: string[] }): APIEmbed {
  return {
    title: t('auditLog.members.left'),
    color: COLOR.delete,
    description: `${user(data.userId)} · **${data.username}**`,
    fields: [
      ...(data.joinedAt ? [{ name: t('auditLog.fields.joined'), value: time(data.joinedAt), inline: true }] : []),
      ...(data.roleIds.length > 0 ? [{ name: t('auditLog.fields.roles'), value: data.roleIds.map((id) => `<@&${id}>`).join(' ').slice(0, 1024) }] : []),
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
  },
): APIEmbed | null {
  const fields: NonNullable<APIEmbed['fields']> = [];
  if (data.nickname) {
    fields.push({
      name: t('auditLog.fields.nickname'),
      value: `${data.nickname.before ?? '—'} → ${data.nickname.after ?? '—'}`,
    });
  }
  if (data.rolesAdded.length > 0) fields.push({ name: t('auditLog.fields.rolesAdded'), value: data.rolesAdded.map((id) => `<@&${id}>`).join(' ') });
  if (data.rolesRemoved.length > 0) fields.push({ name: t('auditLog.fields.rolesRemoved'), value: data.rolesRemoved.map((id) => `<@&${id}>`).join(' ') });
  if (data.timeoutUntil !== undefined) {
    fields.push({ name: t('auditLog.fields.timeout'), value: data.timeoutUntil ? time(data.timeoutUntil, 'f') : t('auditLog.members.timeoutRemoved') });
  }
  if (fields.length === 0) return null;
  return { title: t('auditLog.members.updated'), color: COLOR.update, description: user(data.userId), fields, timestamp: new Date().toISOString() };
}

export function voiceChanged(t: Translate, data: { userId: string; from: string | null; to: string | null }): APIEmbed | null {
  if (data.from === data.to) return null;
  const [title, color] = !data.from
    ? [t('auditLog.voice.joined'), COLOR.create]
    : !data.to
      ? [t('auditLog.voice.left'), COLOR.delete]
      : [t('auditLog.voice.moved'), COLOR.update];
  return {
    title,
    color,
    description: [user(data.userId), data.from && channel(data.from), data.to && channel(data.to)].filter(Boolean).join(' → '),
    timestamp: new Date().toISOString(),
  };
}

export function serverChanged(t: Translate, data: { kind: 'channelCreated' | 'channelDeleted' | 'roleCreated' | 'roleDeleted'; name: string; id: string }): APIEmbed {
  const created = data.kind.endsWith('Created');
  return {
    title: t(`auditLog.server.${data.kind}`),
    color: created ? COLOR.create : COLOR.delete,
    description: `**${data.name}** (\`${data.id}\`)`,
    timestamp: new Date().toISOString(),
  };
}

export function banChanged(t: Translate, data: { userId: string; username: string; banned: boolean; reason: string | null }): APIEmbed {
  return {
    title: t(data.banned ? 'auditLog.moderation.banned' : 'auditLog.moderation.unbanned'),
    color: data.banned ? COLOR.delete : COLOR.create,
    description: `${user(data.userId)} · **${data.username}**`,
    fields: data.reason ? [{ name: t('auditLog.fields.reason'), value: data.reason.slice(0, 1024) }] : [],
    timestamp: new Date().toISOString(),
  };
}
