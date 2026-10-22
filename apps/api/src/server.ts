import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { SessionStore } from './auth/sessions.js';
import { TokenCipher } from './auth/token-cipher.js';
import { UserGuildService } from './auth/user-guilds.js';
import type { ApiDeps } from './deps.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerHttpMetrics } from './plugins/metrics.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { sessionPlugin } from './plugins/session.js';
import { authRoutes } from './routes/auth.js';
import { guildRoutes } from './routes/guilds.js';
import { profileRoutes } from './routes/profile.js';
import { meRoutes } from './routes/me.js';
import { moduleRoutes } from './routes/modules.js';
import { statusRoutes } from './routes/status.js';
import { healthRoutes } from './routes/health.js';

/** Fastify's request log line, without the query: OAuth codes and states travel in it (`/v1/auth/callback`). */
function logRequest(request: FastifyRequest) {
  return { method: request.method, url: request.url.split('?')[0], host: request.host, remoteAddress: request.ip };
}

export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({
    // pino 10 matches Fastify's logger interface but not its type generics.
    loggerInstance: deps.logger.child({}, { serializers: { req: logRequest } }) as unknown as FastifyBaseLogger,
    genReqId: () => `req_${randomUUID()}`,
    // The nearest `trustedProxies` hops, not `true`: with `true` the leftmost X-Forwarded-For entry wins, and the client
    // writes that one.
    trustProxy: (_address: string, hop: number) => hop < deps.options.trustedProxies,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  registerHttpMetrics(app);

  await app.register(cors, { origin: deps.options.webOrigin, credentials: true });

  if (deps.options.docs) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'DiscordBot API', version: '1.0.0' },
        servers: [{ url: deps.options.publicUrl }],
        components: {
          securitySchemes: {
            session: { type: 'apiKey', in: 'cookie', name: 'sid' },
            bearer: { type: 'http', scheme: 'bearer', description: 'Session token of an external client (POST /v1/auth/token)' },
            client: { type: 'http', scheme: 'basic', description: 'External client id and secret (LINK_CLIENTS)' },
          },
        },
        security: [{ session: [] }, { bearer: [] }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  const sessions = new SessionStore(deps.redis, new TokenCipher(deps.options.sessionSecret));
  await app.register(sessionPlugin, {
    store: sessions,
    secret: deps.options.sessionSecret,
  });
  if (deps.options.rateLimitPerMinute > 0) await registerRateLimit(app, deps.redis, deps.options.rateLimitPerMinute);

  await app.register(healthRoutes(deps));
  await app.register(statusRoutes(deps));
  await app.register(authRoutes({ ...deps, sessions }));

  app.decorateRequest('guild', null);
  const userGuilds = new UserGuildService(deps.redis, deps.oauth, sessions, deps.snapshots);
  await app.register(meRoutes(userGuilds));
  await app.register(guildRoutes(deps, userGuilds));
  await app.register(profileRoutes(deps, userGuilds));
  await app.register(moduleRoutes(deps, userGuilds));

  return app;
}
