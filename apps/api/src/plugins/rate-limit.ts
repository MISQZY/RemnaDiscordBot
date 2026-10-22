import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
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

/**
 * GUILD_WRITE_LIMIT over a whole scope: every change under a guild counts, the modules' own routes too (sending
 * messages, lockdown, publishing panels). Each may call Discord, and a stream of calls Discord refuses (401/403/429)
 * gets the bot's IP banned for all guilds. Not @fastify/rate-limit's handler: the global limit has already run for
 * the request, and the plugin runs only one limit per request.
 */
export function guildWriteLimit(redis: Redis): preHandlerAsyncHookHandler {
  const windowMs = 60_000;
  return async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    const key = `ratelimit:write:${GUILD_WRITE_LIMIT.keyGenerator(request)}`;
    // The window starts with the first change: SET NX gives the key its TTL once, INCR keeps it.
    const results = await redis.multi().set(key, 0, 'PX', windowMs, 'NX').incr(key).pttl(key).exec();
    const count = Number(results?.[1]?.[1] ?? 0);
    if (count <= GUILD_WRITE_LIMIT.max) return;
    const retrySec = Math.max(1, Math.ceil(Number(results?.[2]?.[1] ?? windowMs) / 1000));
    reply.header('retry-after', retrySec);
    throw new ApiError(429, 'RATE_LIMITED', `Too many changes, retry in ${retrySec}s`);
  };
}
