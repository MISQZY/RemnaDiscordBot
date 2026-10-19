import { guildVars, userVars, type TemplateVars } from '@bot/templates';
import type { Guild, GuildMember, PartialGuildMember, User } from 'discord.js';

/** `{user.*}`, `{member.*}`, `{guild.*}` placeholders from discord.js objects. */
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

export function guildTemplateVars(guild: Guild): TemplateVars {
  return guildVars({ id: guild.id, name: guild.name, memberCount: guild.memberCount, iconUrl: guild.iconURL({ size: 256 }) });
}
