import type { ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Provider, SubscriptionCreate, SubscriptionDto, SubscriptionUpdate, type NotificationsConfig } from './config.js';
import type { Provider as FeedProvider, ProviderId } from './providers.js';
import { SubscriptionService } from './service.js';

const SubscriptionParams = z.object({ guildId: z.string(), subscriptionId: z.string() });
const LookupQuery = z.object({ provider: Provider, query: z.string().min(1).max(200) });
const SourceInfo = z.object({ externalId: z.string(), name: z.string(), url: z.string() });

export function notificationsApi(providers: () => Map<ProviderId, FeedProvider>) {
  return (app: FastifyInstance, ctx: ApiModuleContext<NotificationsConfig>): void => {
    const service = new SubscriptionService(ctx, providers);
    const params = (request: FastifyRequest) => request.params as { guildId: string; subscriptionId: string };

    app.get(
      '/lookup',
      { schema: { tags: ['notifications'], summary: 'Find a YouTube channel or Twitch streamer', querystring: LookupQuery, response: { 200: SourceInfo } } },
      async (request) => {
        const { provider, query } = request.query as z.infer<typeof LookupQuery>;
        return service.lookup(provider, query);
      },
    );

    app.get(
      '/subscriptions',
      { schema: { tags: ['notifications'], summary: 'Guild subscriptions', response: { 200: z.array(SubscriptionDto) } } },
      async (request) => service.list(params(request).guildId),
    );

    app.post(
      '/subscriptions',
      { schema: { tags: ['notifications'], summary: 'Subscribe to a channel or streamer', body: SubscriptionCreate, response: { 201: SubscriptionDto } } },
      async (request, reply) => {
        const { guildId } = params(request);
        const created = await service.create(guildId, request.body as SubscriptionCreate, await ctx.guildEntities(guildId));
        return reply.status(201).send(created);
      },
    );

    app.patch(
      '/subscriptions/:subscriptionId',
      {
        schema: {
          tags: ['notifications'],
          summary: 'Update a subscription',
          params: SubscriptionParams,
          body: SubscriptionUpdate,
          response: { 200: SubscriptionDto },
        },
      },
      async (request) => {
        const { guildId, subscriptionId } = params(request);
        return service.update(guildId, subscriptionId, request.body as SubscriptionUpdate, await ctx.guildEntities(guildId));
      },
    );

    app.delete(
      '/subscriptions/:subscriptionId',
      { schema: { tags: ['notifications'], summary: 'Unsubscribe', params: SubscriptionParams, response: { 204: z.null() } } },
      async (request, reply) => {
        const { guildId, subscriptionId } = params(request);
        await service.remove(guildId, subscriptionId);
        return reply.status(204).send(null);
      },
    );
  };
}
