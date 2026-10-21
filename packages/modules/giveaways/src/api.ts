import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GiveawayDto, GiveawayInput, type GiveawaysConfig } from './config.js';
import { GiveawayService, toGiveawayDto } from './service.js';

const IdParams = z.object({ guildId: z.string(), id: z.string() });

export function giveawaysApi(app: FastifyInstance, ctx: ApiModuleContext<GiveawaysConfig>): void {
  const service = new GiveawayService(ctx);
  const params = (request: FastifyRequest) => request.params as { guildId: string; id: string };

  app.get(
    '/giveaways',
    {
      schema: {
        tags: ['giveaways'],
        summary: 'Giveaways, newest first',
        querystring: z.object({ status: z.enum(['running', 'ended', 'cancelled']).optional() }),
        response: { 200: z.array(GiveawayDto) },
      },
    },
    async (request) => {
      const { status } = request.query as { status?: string };
      return (await ctx.db.giveaway.findMany({ where: { guildId: params(request).guildId, status }, orderBy: { createdAt: 'desc' }, take: 50 })).map(toGiveawayDto);
    },
  );

  app.post('/giveaways', { schema: { tags: ['giveaways'], summary: 'Start a giveaway', body: GiveawayInput, response: { 201: GiveawayDto } } }, async (request, reply) => {
    const { guildId } = params(request);
    const input = request.body as GiveawayInput;
    const checker = new EntityChecker(await ctx.guildEntities(guildId)).textChannel(input.channelId, ['channelId']).roles(input.requiredRoleIds, ['requiredRoleIds']);
    if (checker.issues.length > 0) throw HttpError.badRequest('Unknown channel or roles', checker.issues);
    return reply.status(201).send(toGiveawayDto(await service.start(guildId, input, ctx.currentUserId(request), await ctx.getConfig(guildId))));
  });

  const action = (path: string, summary: string, run: (id: string, guildId: string, body: { count?: number }) => Promise<unknown>) =>
    app.post(
      `/giveaways/:id/${path}`,
      { schema: { tags: ['giveaways'], summary, params: IdParams, body: z.object({ count: z.number().int().min(1).max(50).optional() }).default({}), response: { 200: GiveawayDto } } },
      async (request) => {
        const { guildId, id } = params(request);
        await run(id, guildId, request.body as { count?: number });
        return toGiveawayDto(await service.find(guildId, id));
      },
    );

  action('end', 'End now and draw the winners', async (id, guildId) => service.end(await service.find(guildId, id), await ctx.getConfig(guildId)));
  action('reroll', 'Draw new winners of an ended giveaway', async (id, guildId, body) =>
    service.end(await service.find(guildId, id), await ctx.getConfig(guildId), { reroll: body.count ?? 1 }),
  );
  action('cancel', 'Cancel without winners', async (id, guildId) => service.cancel(await service.find(guildId, id), await ctx.getConfig(guildId)));

  app.delete('/giveaways/:id', { schema: { tags: ['giveaways'], summary: 'Delete a giveaway and its message', params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
    await service.delete(await service.find(params(request).guildId, params(request).id));
    return reply.status(204).send(null);
  });
}
