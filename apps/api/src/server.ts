import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { SessionStore } from './auth/sessions.js';
import { TokenCipher } from './auth/token-cipher.js';
import { UserGuildService } from './auth/user-guilds.js';
import type { ApiDeps } from './deps.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { sessionPlugin } from './plugins/session.js';
import { authRoutes } from './routes/auth.js';
import { guildRoutes } from './routes/guilds.js';
import { meRoutes } from './routes/me.js';
import { moduleRoutes } from './routes/modules.js';
import { statusRoutes } from './routes/status.js';
import { healthRoutes } from './routes/health.js';

export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({
    // pino 10 совместим с логгером Fastify по интерфейсу, но не по дженерикам типов.
    loggerInstance: deps.logger as unknown as FastifyBaseLogger,
    genReqId: () => `req_${randomUUID()}`,
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(cors, { origin: deps.options.webOrigin, credentials: true });

  if (deps.options.docs) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'DiscordBot API', version: '1.0.0' },
        servers: [{ url: deps.options.publicUrl }],
        components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'sid' } } },
        security: [{ session: [] }],
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
  await app.register(moduleRoutes(deps, userGuilds));

  return app;
}
