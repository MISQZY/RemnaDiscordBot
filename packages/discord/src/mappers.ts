import type { GuildChannel, GuildEmoji, GuildMeta, GuildRole } from '@bot/contracts';
import type { GuildEntities } from '@bot/core';
import type { Guild, GuildBasedChannel, GuildEmoji as DiscordEmoji, Role } from 'discord.js';
import { canAssignRole, isElevatedRole } from './role-safety.js';

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
    manageable: canAssignRole(role),
    elevated: isElevatedRole(role),
  };
}

/** Channels and roles from the gateway cache — what the API reads from the snapshot, for the same checks in the bot. */
export function toGuildEntities(guild: Guild): GuildEntities {
  return {
    channels: [...guild.channels.cache.values()].map(toGuildChannel),
    roles: [...guild.roles.cache.values()].map(toGuildRole),
  };
}

export function toGuildEmoji(emoji: DiscordEmoji): GuildEmoji {
  return {
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated ?? false,
  };
}
