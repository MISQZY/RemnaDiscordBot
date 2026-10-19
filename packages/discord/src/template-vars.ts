import { botVars, guildVars, userVars, type TemplateVars } from '@bot/templates';
import type { Guild, GuildMember, PartialGuildMember, User } from 'discord.js';

/** `{user.*}`, `{member.*}`, `{guild.*}`, `{bot.*}` placeholders from discord.js objects. */
export function memberTemplateVars(member: GuildMember | PartialGuildMember): TemplateVars {
  return {
    ...userTemplateVars(member.user, member),
    ...guildTemplateVars(member.guild),
  };
}

export function userTemplateVars(user: User, member?: GuildMember | PartialGuildMember): TemplateVars {
  return userVars(
    {
      id: user.id,
      username: user.username,
      globalName: user.globalName,
      avatarUrl: user.displayAvatarURL({ size: 256 }),
      createdAt: user.createdAt,
    },
    member && { nickname: member.nickname, joinedAt: member.joinedAt },
  );
}

/** `{guild.*}` and `{bot.*}`: the bot as this server shows it (its nickname and server avatar there). */
export function guildTemplateVars(guild: Guild): TemplateVars {
  const me = guild.members.me;
  const bot = guild.client.user;
  return {
    ...guildVars({ id: guild.id, name: guild.name, memberCount: guild.memberCount, iconUrl: guild.iconURL({ size: 256 }) }),
    ...botVars({
      id: bot.id,
      name: me?.displayName ?? bot.displayName,
      avatarUrl: (me ?? bot).displayAvatarURL({ size: 256 }),
    }),
  };
}
