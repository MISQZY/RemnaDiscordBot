import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { ApiError } from '../errors.js';

/** Ключ лимита: пользователь, если вошёл, иначе IP. */
const clientKey = (request: FastifyRequest) => (request.session ? `user:${request.session.userId}` : `ip:${request.ip}`);

/** Лимиты на запись в гильдию — по гильдии и пользователю. */
export const GUILD_WRITE_LIMIT = {
  max: 20,
  timeWindow: '1 minute',
  keyGenerator: (request: FastifyRequest) =>
    `guild:${(request.params as { guildId?: string }).guildId}:${clientKey(request)}`,
};

/**
 * Глобальный лимит со счётчиками в Redis — общий для всех реплик API.
 * Проверяется в preHandler, когда сессия и параметры маршрута уже известны.
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
