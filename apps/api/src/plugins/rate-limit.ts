import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { ApiError } from '../errors.js';

/** Rate limit key: the user when logged in, otherwise the IP. */
const clientKey = (request: FastifyRequest) => (request.session ? `user:${request.session.userId}` : `ip:${request.ip}`);

/** Guild write limits — per guild and user. */
export const GUILD_WRITE_LIMIT = {
  max: 20,
  timeWindow: '1 minute',
  keyGenerator: (request: FastifyRequest) =>
    `guild:${(request.params as { guildId?: string }).guildId}:${clientKey(request)}`,
};

/**
 * Global limit with counters in Redis — shared by all API replicas.
 * Checked in preHandler, when the session and route params are already known.
 */
export async function registerRateLimit(app: FastifyInstance, redis: Redis, max = 120): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max,
    timeWindow: '1 minute',
    hook: 'preHandler',
    redis,
    nameSpace: 'ratelimit:',
    keyGenerator: clientKey,
    errorResponseBuilder: (_request, context) =>
      new ApiError(429, 'RATE_LIMITED', `Too many requests, retry in ${Math.ceil(context.ttl / 1000)}s`),
  });
}
