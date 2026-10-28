import { Snowflake } from '@bot/contracts';
import type { ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '@bot/core';
import { DeliveryError, Provider, SourceError, SubscriptionCreate, SubscriptionDto, SubscriptionUpdate, toDto, type NotificationsConfig } from './config.js';
import { checkNow } from './poll.js';
import type { Provider as FeedProvider, ProviderId } from './providers.js';
import { SubscriptionError, SubscriptionService } from './service.js';

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
/** Optional: without a body the source is only checked. */
const CheckBody = z.object({ sendLatest: z.boolean().default(false) }).nullish();
const CheckResult = z.object({
  error: SourceError.nullable(),
  items: z.number().int(),
  fresh: z.number().int(),
  posted: z.number().int(),
  latest: z.union([z.literal('posted'), z.literal('skipped'), DeliveryError]).nullable(),
  subscription: SubscriptionDto,
});

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

    app.post(
      '/subscriptions/:subscriptionId/check',
      {
        schema: {
          tags: ['notifications'],
          summary: 'Check the source now; with sendLatest, also post its newest item to this subscription',
          description: 'New items go out as on schedule. Not for webhooks: they are called, not checked.',
          params: SubscriptionParams,
          body: CheckBody,
          response: { 200: CheckResult },
        },
      },
      async (request) => {
        const { guildId, subscriptionId } = params(request);
        // It may post in Discord: only while the module is on.
        await ctx.requireEnabled(guildId);
        const row = await service.find(guildId, subscriptionId);
        const id = Provider.parse(row.source.provider);
        if (id === 'webhook') throw HttpError.badRequest('A webhook is called, not checked');
        const provider = service.provider(id);
        if (provider.vipFeature && ctx.config.vip.featureLocked(guildId, provider.vipFeature)) {
          throw new SubscriptionError('vipRequired', new HttpError(403, 'VIP_REQUIRED', `"${provider.vipFeature}" needs VIP in this guild`));
        }
        const sendLatest = (request.body as z.infer<typeof CheckBody>)?.sendLatest ?? false;
        const report = await checkNow(ctx, provider, row, { sendLatest });
        return { ...report, subscription: toDto(await service.find(guildId, subscriptionId)) };
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
