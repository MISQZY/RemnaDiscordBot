import { createServer } from 'node:http';
import {
  ConfigService,
  EventBus,
  GuildLocales,
  IntervalRunner,
  JobRunner,
  ModuleRegistry,
  PrismaConfigStore,
  RedisConfigCache,
  Scheduler,
  handleMetricsRequest,
  publishConfigInvalidation,
  registerCoreLocales,
  subscribeConfigInvalidation,
  type CoreServices,
} from '@bot/core';
import { createDatabaseClient } from '@bot/db';
import { I18n } from '@bot/i18n';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { REST } from 'discord.js';
import { Redis } from 'ioredis';
import { Gauge, collectDefaultMetrics } from 'prom-client';
import { loadWorkerEnv } from './env.js';

const env = loadWorkerEnv();
const logger = createLogger({ service: 'worker', level: env.LOG_LEVEL });
collectDefaultMetrics();

/** A job counts as overdue once it waits this long past its run time. */
const OVERDUE_GRACE_MS = 60_000;
const MAX_ATTEMPTS = 5;

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
const unsubscribeConfig = await subscribeConfigInvalidation(redis, logger, (message) => {
  config.invalidate(message);
  // Whole-guild invalidation — general settings, including the language, may have changed.
  if (!message.moduleId) guildLocales.invalidate(message.guildId);
});

const services: CoreServices = {
  logger,
  db,
  redis,
  i18n,
  bus: new EventBus(logger),
  config,
  scheduler: new Scheduler(db),
  guildLocales,
  rest: new REST().setToken(env.DISCORD_TOKEN),
};

new Gauge({
  name: 'jobs_overdue',
  help: `Jobs waiting more than ${OVERDUE_GRACE_MS / 1000}s past their run time`,
  async collect() {
    this.set(await services.scheduler.countOverdue(OVERDUE_GRACE_MS, MAX_ATTEMPTS));
  },
});

const jobs = new JobRunner(services, registry, { maxAttempts: MAX_ATTEMPTS });
const intervals = new IntervalRunner(services, registry);
jobs.start(env.WORKER_POLL_MS);
intervals.start();

const health = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }));
  } else if (!handleMetricsRequest(req, res, { token: env.METRICS_TOKEN, onError: (err) => logger.error({ err }, 'Failed to collect metrics') })) {
    res.writeHead(404).end();
  }
});
health.listen(env.WORKER_HEALTH_PORT, () => logger.info({ port: env.WORKER_HEALTH_PORT }, 'Health server listening'));

logger.info(
  {
    jobs: registry.all().flatMap((m) => Object.keys(m.jobs ?? {}).map((job) => `${m.id}:${job}`)),
    intervals: registry.all().flatMap((m) => Object.keys(m.intervals ?? {}).map((name) => `${m.id}:${name}`)),
  },
  'Worker started',
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Worker shutting down');
  try {
    intervals.stop();
    await jobs.stop();
    health.close();
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
