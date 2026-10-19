import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import { isUniqueViolation, type Prisma } from '@bot/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_MESSAGES,
  MAX_SUBSCRIPTIONS,
  Provider,
  SubscriptionCreate,
  SubscriptionDto,
  SubscriptionUpdate,
  toDto,
  type NotificationsConfig,
} from './config.js';
import type { Provider as FeedProvider, ProviderId } from './providers.js';

const SubscriptionParams = z.object({ guildId: z.string(), subscriptionId: z.string() });
const LookupQuery = z.object({ provider: Provider, query: z.string().min(1).max(200) });
const SourceInfo = z.object({ externalId: z.string(), name: z.string(), url: z.string() });

export function notificationsApi(providers: () => Map<ProviderId, FeedProvider>) {
  return (app: FastifyInstance, ctx: ApiModuleContext<NotificationsConfig>): void => {
    const params = (request: FastifyRequest) => request.params as { guildId: string; subscriptionId?: string };

    function provider(id: ProviderId): FeedProvider {
      const found = providers().get(id);
      if (!found) throw HttpError.badRequest(`${id} is not configured on this platform`);
      return found;
    }

    async function findSubscription(guildId: string, id: string) {
      const row = await ctx.db.notificationSubscription.findUnique({ where: { id }, include: { source: true } });
      if (!row || row.guildId !== guildId) throw HttpError.notFound('Subscription not found');
      return row;
    }

    async function validate(guildId: string, channelId: string | undefined, mentionRoleId: string | null | undefined) {
      const { issues } = new EntityChecker(await ctx.guildEntities(guildId)).textChannel(channelId, ['channelId']).role(mentionRoleId, ['mentionRoleId']);
      if (issues.length > 0) throw HttpError.badRequest('Subscription references unknown channels or roles', issues);
    }

    app.get(
      '/lookup',
      { schema: { tags: ['notifications'], summary: 'Найти канал YouTube или стримера Twitch', querystring: LookupQuery, response: { 200: SourceInfo } } },
      async (request) => {
        const { provider: id, query } = request.query as z.infer<typeof LookupQuery>;
        return provider(id).lookup(query);
      },
    );

    app.get(
      '/subscriptions',
      { schema: { tags: ['notifications'], summary: 'Подписки гильдии', response: { 200: z.array(SubscriptionDto) } } },
      async (request) =>
        (
          await ctx.db.notificationSubscription.findMany({
            where: { guildId: params(request).guildId },
            include: { source: true },
            orderBy: { createdAt: 'asc' },
          })
        ).map(toDto),
    );

    app.post(
      '/subscriptions',
      { schema: { tags: ['notifications'], summary: 'Подписаться на канал или стримера', body: SubscriptionCreate, response: { 201: SubscriptionDto } } },
      async (request, reply) => {
        const { guildId } = params(request);
        const input = request.body as SubscriptionCreate;
        if ((await ctx.db.notificationSubscription.count({ where: { guildId } })) >= MAX_SUBSCRIPTIONS) {
          throw HttpError.badRequest(`A guild can have at most ${MAX_SUBSCRIPTIONS} subscriptions`);
        }
        await validate(guildId, input.channelId, input.mentionRoleId);

        const info = await provider(input.provider).lookup(input.query);
        const source = await ctx.db.notificationSource.upsert({
          where: { provider_externalId: { provider: input.provider, externalId: info.externalId } },
          create: { provider: input.provider, externalId: info.externalId, name: info.name },
          update: { name: info.name },
        });
        try {
          const row = await ctx.db.notificationSubscription.create({
            data: {
              guildId,
              sourceId: source.id,
              channelId: input.channelId,
              mentionRoleId: input.mentionRoleId,
              message: (input.message ?? DEFAULT_MESSAGES[input.provider]) as Prisma.InputJsonValue,
            },
            include: { source: true },
          });
          return reply.status(201).send(toDto(row));
        } catch (err) {
          if (isUniqueViolation(err)) throw new HttpError(409, 'CONFLICT', 'This guild is already subscribed to this source');
          throw err;
        }
      },
    );

    app.patch(
      '/subscriptions/:subscriptionId',
      {
        schema: {
          tags: ['notifications'],
          summary: 'Изменить подписку',
          params: SubscriptionParams,
          body: SubscriptionUpdate,
          response: { 200: SubscriptionDto },
        },
      },
      async (request) => {
        const { guildId, subscriptionId } = params(request);
        const existing = await findSubscription(guildId, subscriptionId!);
        const input = request.body as SubscriptionUpdate;
        await validate(guildId, input.channelId, input.mentionRoleId);
        const row = await ctx.db.notificationSubscription.update({
          where: { id: existing.id },
          data: { ...input, ...(input.message ? { message: input.message as Prisma.InputJsonValue } : {}) },
          include: { source: true },
        });
        return toDto(row);
      },
    );

    app.delete(
      '/subscriptions/:subscriptionId',
      { schema: { tags: ['notifications'], summary: 'Отписаться', params: SubscriptionParams, response: { 204: z.null() } } },
      async (request, reply) => {
        const { guildId, subscriptionId } = params(request);
        const row = await findSubscription(guildId, subscriptionId!);
        await ctx.db.notificationSubscription.delete({ where: { id: row.id } });
        // Источник без подписок больше не нужен — его перестанут опрашивать.
        await ctx.db.notificationSource.deleteMany({ where: { id: row.sourceId, subscriptions: { none: {} } } });
        return reply.status(204).send(null);
      },
    );
  };
}
