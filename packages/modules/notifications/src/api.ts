import { Snowflake } from '@bot/contracts';
import type { ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Provider, SubscriptionCreate, SubscriptionDto, SubscriptionUpdate, type NotificationsConfig } from './config.js';
import type { Provider as FeedProvider, ProviderId } from './providers.js';
import { SubscriptionService } from './service.js';

const SubscriptionParams = z.object({ guildId: Snowflake, subscriptionId: z.string() });
const LookupQuery = z.object({ provider: Provider.exclude(['webhook', 'api']), query: z.string().min(1).max(500) });
const ProviderInfo = z.object({
  id: Provider,
  /** The platform is set up for the bot (Twitch needs its keys). */
  configured: z.boolean(),
  /** It needs VIP this guild does not have. */
  vipRequired: z.boolean(),
});
const SourceInfo = z.object({ externalId: z.string(), name: z.string(), url: z.string() });

export function notificationsApi(providers: () => Map<ProviderId, FeedProvider>) {
  return (app: FastifyInstance, ctx: ApiModuleContext<NotificationsConfig>): void => {
    const service = new SubscriptionService(ctx, providers);
    const params = (request: FastifyRequest) => request.params as { guildId: string; subscriptionId: string };

    app.get(
      '/providers',
      { schema: { tags: ['notifications'], summary: 'Which providers a guild can subscribe with', response: { 200: z.array(ProviderInfo) } } },
      async (request) => {
        const { guildId } = params(request);
        const available = providers();
        return Provider.options.map((id) => {
          // A webhook needs nothing of the bot's.
          const provider = id === 'webhook' ? undefined : available.get(id);
          const feature = provider?.vipFeature;
          return { id, configured: id === 'webhook' || provider !== undefined, vipRequired: feature ? ctx.config.vip.featureLocked(guildId, feature) : false };
        });
      },
    );

    app.get(
      '/lookup',
      { schema: { tags: ['notifications'], summary: 'Find a YouTube channel, a Twitch streamer or a feed', querystring: LookupQuery, response: { 200: SourceInfo } } },
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
      { schema: { tags: ['notifications'], summary: 'Subscribe to a channel, a streamer or a feed', body: SubscriptionCreate, response: { 201: SubscriptionDto } } },
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

    app.post(
      '/subscriptions/:subscriptionId/token',
      {
        schema: {
          tags: ['notifications'],
          summary: "Give a webhook a new secret address; the old one stops working",
          params: SubscriptionParams,
          response: { 200: SubscriptionDto },
        },
      },
      async (request) => {
        const { guildId, subscriptionId } = params(request);
        return service.regenerateToken(guildId, subscriptionId);
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
