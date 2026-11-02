import type { UserGuild } from '@bot/contracts';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { UserGuildService } from '../auth/user-guilds.js';
import { ApiError } from '../errors.js';
import { requireSession } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The guild from `:guildId` the user was checked to have access to. */
    guild: UserGuild | null;
  }
}

export type GuildAccessLevel = 'manage' | 'moderator';

/**
 * Access to `/v1/guilds/:guildId/*`: the user is logged in, has the required permission
 * level ('manage' for owners/administrators; 'moderator' also permits users with a role from modRoleIds)
 * and the bot is on the server.
 */
export function requireGuildAccess(userGuilds: UserGuildService, level: GuildAccessLevel = 'manage'): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest) => {
    const session = requireSession(request);
    const { guildId } = request.params as { guildId?: string };
    if (!guildId) throw ApiError.notFound();

    // While Discord refuses, reads may go by the user's last known guilds; changes wait for a fresh answer, which may
    // have taken the permission away.
    const guild = await userGuilds.find(session, guildId, { stale: request.method === 'GET' || request.method === 'HEAD' });
    if (!guild) throw ApiError.forbidden('You do not have access to this guild');
    if (!guild.botPresent) throw ApiError.botNotInGuild();

    if (level === 'manage' && !guild.canManage) {
      throw ApiError.forbidden('You cannot manage this guild');
    }
    if (level === 'moderator' && !guild.canManage && !guild.isModerator) {
      if (request.url.includes('/modules/music/player')) {
        request.guild = guild;
        return;
      }
      throw ApiError.forbidden('You cannot moderate this guild');
    }
    request.guild = guild;
  };
}

export function requireGuild(request: FastifyRequest): UserGuild {
  if (!request.guild) throw ApiError.forbidden();
  return request.guild;
}
