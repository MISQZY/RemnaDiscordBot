import { GuildMeta, Snowflake, VipState } from '@bot/contracts';
import { eachLimit, PrismaVipStore, publishVipChanged } from '@bot/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticateClient } from '../auth/link-clients.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';

/** VIP is kept by an external dashboard (its keys and who activated them); the bot only learns the result. */
export function vipRoutes({ db, redis, registry, config, options, snapshots }: ApiDeps): FastifyPluginAsyncZod {
  const store = new PrismaVipStore(db);

  return async (app) => {
    const guildSchema = GuildMeta.pick({ id: true, name: true, icon: true, memberCount: true, shardId: true });
    const requireClient = (authorization: string | undefined) => {
      if (!authenticateClient(options.linkClients, authorization)) {
        throw ApiError.unauthorized('Unknown client or wrong secret');
      }
    };

    app.get(
      '/v1/vip/guilds',
      {
        schema: {
          tags: ['vip'],
          summary: 'List servers with the bot for the VIP dashboard',
          security: [{ client: [] }],
          response: { 200: z.array(guildSchema) },
        },
      },
      async (request) => {
        requireClient(request.headers.authorization);
        const rows = await db.guild.findMany({ where: { leftAt: null }, select: { id: true }, orderBy: { joinedAt: 'desc' } });
        const guilds = new Map<string, z.infer<typeof guildSchema>>();
        await eachLimit(rows, 10, async ({ id }) => {
          const meta = await snapshots.getMeta(id);
          if (meta) guilds.set(id, meta);
        });
        return rows.flatMap(({ id }) => guilds.has(id) ? [guilds.get(id)!] : []);
      },
    );

    app.get(
      '/v1/vip/guilds/:guildId',
      {
        schema: {
          tags: ['vip'],
          summary: 'Read a connected server before assigning a VIP key',
          security: [{ client: [] }],
          params: z.object({ guildId: Snowflake }),
          response: { 200: guildSchema },
        },
      },
      async (request) => {
        requireClient(request.headers.authorization);
        const guild = await db.guild.findUnique({ where: { id: request.params.guildId }, select: { leftAt: true } });
        const meta = await snapshots.getMeta(request.params.guildId);
        if (!guild || guild.leftAt || !meta) throw ApiError.botNotInGuild();
        return meta;
      },
    );

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
        requireClient(request.headers.authorization);
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
