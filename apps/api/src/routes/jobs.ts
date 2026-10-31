import { FailedJobItem, FailedJobsPage, Snowflake } from '@bot/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticateClient } from '../auth/link-clients.js';
import type { Session } from '../auth/sessions.js';
import type { UserGuildService } from '../auth/user-guilds.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';

export function jobsRoutes(deps: ApiDeps, userGuilds: UserGuildService): FastifyPluginAsyncZod {
  return async (app) => {
    const isClient = (authorization: string | undefined) =>
      Boolean(authenticateClient(deps.options.linkClients, authorization));

    const checkAccess = async (authorization: string | undefined, session: Session | null | undefined, guildId?: string) => {
      if (isClient(authorization)) return;
      if (!session) throw ApiError.unauthorized();
      if (!guildId) throw ApiError.forbidden('Global failed jobs list requires client authentication');
      const guild = await userGuilds.find(session, guildId);
      if (!guild?.canManage) throw ApiError.forbidden();
    };

    app.get(
      '/v1/jobs/failed',
      {
        schema: {
          tags: ['jobs'],
          summary: 'List permanently failed scheduled jobs',
          security: [{ client: [] }, { session: [] }, { bearer: [] }],
          querystring: z.object({
            guildId: Snowflake.optional(),
            cursor: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          }),
          response: { 200: FailedJobsPage },
        },
      },
      async (request) => {
        await checkAccess(request.headers.authorization, request.session, request.query.guildId);

        const { items, nextCursor } = await deps.scheduler.findFailed({
          guildId: request.query.guildId,
          limit: request.query.limit,
          cursor: request.query.cursor,
        });

        const enriched = await Promise.all(
          items.map(async (item) => {
            const meta = await deps.snapshots.getMeta(item.guildId);
            return {
              id: item.id,
              guildId: item.guildId,
              guildName: meta?.name ?? null,
              guildIcon: meta?.icon ?? null,
              type: item.type,
              payload: item.payload,
              runAt: item.runAt.toISOString(),
              doneAt: (item.doneAt ?? new Date()).toISOString(),
              attempts: item.attempts,
              lastError: item.lastError ?? 'Unknown error',
              key: item.key ?? null,
              createdAt: item.createdAt.toISOString(),
            };
          }),
        );

        return { items: enriched, nextCursor };
      },
    );

    app.post(
      '/v1/jobs/:id/retry',
      {
        schema: {
          tags: ['jobs'],
          summary: 'Retry a permanently failed scheduled job',
          security: [{ client: [] }, { session: [] }, { bearer: [] }],
          params: z.object({ id: z.string() }),
          response: { 200: FailedJobItem },
        },
      },
      async (request) => {
        const existing = await deps.db.scheduledAction.findUnique({ where: { id: request.params.id } });
        if (!existing) throw ApiError.notFound('Job not found');

        await checkAccess(request.headers.authorization, request.session, existing.guildId);

        const retried = await deps.scheduler.retry(existing.id);
        if (!retried) throw ApiError.conflict('Only permanently failed jobs can be retried');

        const meta = await deps.snapshots.getMeta(retried.guildId);
        return {
          id: retried.id,
          guildId: retried.guildId,
          guildName: meta?.name ?? null,
          guildIcon: meta?.icon ?? null,
          type: retried.type,
          payload: retried.payload,
          runAt: retried.runAt.toISOString(),
          doneAt: (retried.doneAt ?? new Date()).toISOString(),
          attempts: retried.attempts,
          lastError: retried.lastError ?? '',
          key: retried.key ?? null,
          createdAt: retried.createdAt.toISOString(),
        };
      },
    );

    app.delete(
      '/v1/jobs/:id',
      {
        schema: {
          tags: ['jobs'],
          summary: 'Cancel and delete a scheduled job',
          security: [{ client: [] }, { session: [] }, { bearer: [] }],
          params: z.object({ id: z.string() }),
          response: { 200: z.object({ ok: z.boolean() }) },
        },
      },
      async (request) => {
        const existing = await deps.db.scheduledAction.findUnique({ where: { id: request.params.id } });
        if (!existing) throw ApiError.notFound('Job not found');

        await checkAccess(request.headers.authorization, request.session, existing.guildId);

        await deps.scheduler.cancelById(existing.id);
        return { ok: true };
      },
    );
  };
}
