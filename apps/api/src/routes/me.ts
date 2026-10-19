import { CurrentUser, UserGuild } from '@bot/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { UserGuildService } from '../auth/user-guilds.js';
import { requireSession } from '../plugins/session.js';

export function meRoutes(userGuilds: UserGuildService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/v1/me',
      { schema: { tags: ['me'], summary: 'Текущий пользователь', response: { 200: CurrentUser } } },
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
          summary: 'Гильдии пользователя',
          description: 'Сначала те, которыми пользователь может управлять. Кэшируется на минуту.',
          response: { 200: z.array(UserGuild) },
        },
      },
      async (request) => userGuilds.list(requireSession(request)),
    );
  };
}
