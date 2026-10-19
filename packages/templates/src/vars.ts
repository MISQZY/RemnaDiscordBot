import type { TemplateVars } from './render.js';

/** Placeholders of common entities. Modules add their own (`level`, `case.id`, …). */

export interface UserLike {
  id: string;
  username: string;
  globalName?: string | null;
  avatarUrl?: string | null;
  createdAt?: Date;
}

export interface MemberLike {
  nickname?: string | null;
  joinedAt?: Date | null;
}

export interface GuildLike {
  id: string;
  name: string;
  memberCount: number;
  iconUrl?: string | null;
}

const date = (value: Date | null | undefined) => (value ? `<t:${Math.floor(value.getTime() / 1000)}:D>` : undefined);

export function userVars(user: UserLike, member?: MemberLike): TemplateVars {
  const displayName = member?.nickname ?? user.globalName ?? user.username;
  return {
    user: `<@${user.id}>`,
    'user.mention': `<@${user.id}>`,
    'user.id': user.id,
    'user.name': user.username,
    'user.displayName': displayName,
    'user.avatar': user.avatarUrl ?? undefined,
    'user.createdAt': date(user.createdAt),
    'member.nick': displayName,
    'member.joinedAt': date(member?.joinedAt),
  };
}

export function guildVars(guild: GuildLike): TemplateVars {
  return {
    'guild.id': guild.id,
    'guild.name': guild.name,
    'guild.memberCount': guild.memberCount,
    'guild.icon': guild.iconUrl ?? undefined,
  };
}

export function channelVars(channel: { id: string; name: string }): TemplateVars {
  return { channel: `<#${channel.id}>`, 'channel.name': channel.name };
}

/** List of common placeholders — for hints in the template editor. */
export const COMMON_PLACEHOLDERS = [
  'user',
  'user.mention',
  'user.id',
  'user.name',
  'user.displayName',
  'user.avatar',
  'user.createdAt',
  'member.nick',
  'member.joinedAt',
  'guild.id',
  'guild.name',
  'guild.memberCount',
  'guild.icon',
] as const;
