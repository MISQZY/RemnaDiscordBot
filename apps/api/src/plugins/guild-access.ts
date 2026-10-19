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

/**
 * Access to `/v1/guilds/:guildId/*`: the user is logged in, can manage the guild
 * (owner, Administrator or Manage Server) and the bot is on the server.
 */
export function requireGuildAccess(userGuilds: UserGuildService): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest) => {
    const session = requireSession(request);
    const { guildId } = request.params as { guildId?: string };
    if (!guildId) throw ApiError.notFound();

    const guild = await userGuilds.find(session, guildId);
    if (!guild?.canManage) throw ApiError.forbidden('You cannot manage this guild');
    if (!guild.botPresent) throw ApiError.botNotInGuild();
    request.guild = guild;
  };
}

export function requireGuild(request: FastifyRequest): UserGuild {
  if (!request.guild) throw ApiError.forbidden();
  return request.guild;
}
