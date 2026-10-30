import { CurrentUser, UserGuild } from '@bot/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { UserGuildService } from '../auth/user-guilds.js';
import { requireSession } from '../plugins/session.js';

export function meRoutes(userGuilds: UserGuildService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/v1/me',
      { schema: { tags: ['me'], summary: 'Current user', response: { 200: CurrentUser } } },
      async (request) => {
        const session = requireSession(request);
        return {
          id: session.userId,
          username: session.username,
          globalName: session.globalName,
          avatar: session.avatar,
        };
      },
    );

    app.get(
      '/v1/me/guilds',
      {
        schema: {
          tags: ['me'],
          summary: "User's guilds",
          description: 'Guilds the user can manage come first. Cached for a minute; ?refresh=1 asks Discord again.',
          querystring: z.object({ refresh: z.literal('1').optional() }),
          response: { 200: z.array(UserGuild) },
        },
      },
      async (request) => userGuilds.list(requireSession(request), { refresh: request.query.refresh === '1' }),
    );
  };
}
