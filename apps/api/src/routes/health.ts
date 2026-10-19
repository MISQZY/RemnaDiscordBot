import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps.js';

const Health = z.object({ status: z.enum(['ok', 'unavailable']) });

/** Liveness и readiness — для Docker и балансировщика; вне `/v1` и без лимита запросов. */
export function healthRoutes({ db, redis }: ApiDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/health',
      { schema: { hide: true, response: { 200: Health } }, config: { rateLimit: false } },
      async () => ({ status: 'ok' as const }),
    );

    app.get(
      '/ready',
      { schema: { hide: true, response: { 200: Health, 503: Health } }, config: { rateLimit: false } },
      async (_request, reply) => {
        try {
          await Promise.all([redis.ping(), db.$queryRaw`SELECT 1`]);
          return { status: 'ok' as const };
        } catch {
          return reply.status(503).send({ status: 'unavailable' as const });
        }
      },
    );
  };
}
