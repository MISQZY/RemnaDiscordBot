import {
  ConfigService,
  EventBus,
  GuildLocales,
  ModuleRegistry,
  PrismaConfigStore,
  RedisConfigCache,
  Scheduler,
  publishConfigInvalidation,
  registerCoreLocales,
  subscribeConfigInvalidation,
} from '@bot/core';
import { createDatabaseClient } from '@bot/db';
import { GuildSnapshotReader } from '@bot/discord';
import { I18n } from '@bot/i18n';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { REST } from 'discord.js';
import { Redis } from 'ioredis';
import { HttpDiscordOAuth } from './auth/discord-oauth.js';
import { loadApiEnv } from './env.js';
import { buildServer } from './server.js';

const env = loadApiEnv();
const logger = createLogger({ service: 'api', level: env.LOG_LEVEL });

const db = await createDatabaseClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
redis.on('error', (err) => logger.error({ err }, 'Redis error'));

const registry = new ModuleRegistry(modules);
const i18n = new I18n(env.DEFAULT_LOCALE);
registerCoreLocales(i18n);
registry.registerLocales(i18n);

const guildLocales = new GuildLocales(db, i18n);
const config = new ConfigService({
  registry,
  store: new PrismaConfigStore(db),
  sharedCache: new RedisConfigCache(redis),
  publish: (message) => publishConfigInvalidation(redis, message),
  locales: { localeOf: (guildId) => guildLocales.get(guildId), i18n },
  logger,
});
// Other API replicas change configs too — the local cache must be invalidated.
const unsubscribeConfig = await subscribeConfigInvalidation(redis, logger, (message) => {
  config.invalidate(message);
  // Whole-guild invalidation — general settings, including the language, may have changed.
  if (!message.moduleId) guildLocales.invalidate(message.guildId);
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
    defaultRedirect: env.WEB_ORIGIN ? '/' : '/docs',
    clientId: env.DISCORD_CLIENT_ID,
    sessionSecret: env.SESSION_SECRET,
    secureCookies: env.API_PUBLIC_URL.startsWith('https://'),
    linkClients: env.LINK_CLIENTS,
    docs: true,
    rateLimitPerMinute: 120,
  },
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'API shutting down');
  try {
    await app.close();
    await unsubscribeConfig();
    await redis.quit();
    await db.$disconnect();
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.API_HOST, port: env.API_PORT });
