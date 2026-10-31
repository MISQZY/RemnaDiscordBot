import { createServer } from 'node:http';
import {
  bootstrapServices,
  EventBus,
  Scheduler,
  handleMetricsRequest,
} from '@bot/core';
import { GuildSnapshotReader } from '@bot/discord';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { REST } from 'discord.js';
import { collectDefaultMetrics } from 'prom-client';
import { HttpDiscordOAuth } from './auth/discord-oauth.js';
import { loadApiEnv } from './env.js';
import { buildServer } from './server.js';

const env = loadApiEnv();
const logger = createLogger({ service: 'api', level: env.LOG_LEVEL });
/** The full API map is for development: production serves it only when asked to. */
const docs = env.API_DOCS ? env.API_DOCS === 'true' : env.NODE_ENV !== 'production';

collectDefaultMetrics();

const { db, redis, registry, i18n, guildLocales, config, close: closeBootstrap } = await bootstrapServices({
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  defaultLocale: env.DEFAULT_LOCALE,
  modules,
  logger,
});

const app = await buildServer({
  logger,
  db,
  redis,
  i18n,
  bus: new EventBus(logger),
  registry,
  config,
  scheduler: new Scheduler(db),
  guildLocales,
  rest: new REST().setToken(env.DISCORD_TOKEN),
  snapshots: new GuildSnapshotReader(redis),
  oauth: new HttpDiscordOAuth(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET),
  options: {
    publicUrl: env.API_PUBLIC_URL,
    webOrigin: env.WEB_ORIGIN ?? env.API_PUBLIC_URL,
    // Until the web app exists, login lands on the API Swagger UI.
    defaultRedirect: env.WEB_ORIGIN || !docs ? '/' : '/docs',
    clientId: env.DISCORD_CLIENT_ID,
    sessionSecret: env.SESSION_SECRET,
    secureCookies: env.API_PUBLIC_URL.startsWith('https://'),
    linkClients: env.LINK_CLIENTS,
    docs,
    rateLimitPerMinute: env.API_RATE_LIMIT_PER_MINUTE,
    trustedProxies: env.API_TRUSTED_PROXIES,
    botProfileEdits: env.BOT_PROFILE_EDITS,
  },
});

const metricsServer = createServer((req, res) => {
  const onError = (err: unknown) => logger.error({ err }, 'Failed to collect metrics');
  if (!handleMetricsRequest(req, res, { token: env.METRICS_TOKEN, onError })) res.writeHead(404).end();
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'API shutting down');
  try {
    await app.close();
    metricsServer.close();
    await closeBootstrap();
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException');
});

await app.listen({ host: env.API_HOST, port: env.API_PORT });
metricsServer.listen(env.API_METRICS_PORT, env.API_HOST, () => logger.info({ port: env.API_METRICS_PORT }, 'Metrics server listening'));
