import { VipState } from '@bot/contracts';
import { PrismaVipStore, publishVipChanged } from '@bot/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticateClient } from '../auth/link-clients.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';

/** VIP is kept by an external dashboard (its keys and who activated them); the bot only learns the result. */
export function vipRoutes({ db, redis, registry, config, options }: ApiDeps): FastifyPluginAsyncZod {
  const store = new PrismaVipStore(db);

  return async (app) => {
    app.put(
      '/v1/vip',
      {
        schema: {
          tags: ['vip'],
          summary: 'Replace VIP: modules that need it and guilds that have it',
          description: 'Server to server: `Authorization: Basic base64(clientId:secret)`. Guilds left out lose VIP.',
          security: [{ client: [] }],
          body: VipState,
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        if (!authenticateClient(options.linkClients, request.headers.authorization)) {
          throw ApiError.unauthorized('Unknown client or wrong secret');
        }
        // A module the bot no longer has, or one that cannot be off, needs no VIP: the rest of the state still applies.
        const state = {
          ...request.body,
          modules: request.body.modules.filter((id) => {
            const module = registry.get(id);
            return module !== undefined && !module.alwaysEnabled;
          }),
        };
        await store.replace(state);
        config.vip.set(state);
        await publishVipChanged(redis);
        return reply.status(204).send(null);
      },
    );
  };
}
