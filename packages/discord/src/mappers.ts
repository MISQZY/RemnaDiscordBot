import type { GuildChannel, GuildEmoji, GuildMeta, GuildRole } from '@bot/contracts';
import type { Guild, GuildBasedChannel, GuildEmoji as DiscordEmoji, Role } from 'discord.js';

export function toGuildMeta(guild: Guild): GuildMeta {
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    shardId: guild.shardId,
  };
}

export function toGuildChannel(channel: GuildBasedChannel): GuildChannel {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: 'position' in channel ? channel.position : 0,
  };
}

export function toGuildRole(role: Role): GuildRole {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    managed: role.managed,
    manageable: role.editable && !role.managed && role.id !== role.guild.id,
  };
}

export function toGuildEmoji(emoji: DiscordEmoji): GuildEmoji {
  return {
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated ?? false,
  };
}
