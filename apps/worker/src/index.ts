import { createServer } from 'node:http';
import {
  ConfigService,
  EventBus,
  IntervalRunner,
  JobRunner,
  ModuleRegistry,
  PrismaConfigStore,
  RedisConfigCache,
  Scheduler,
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
import { loadWorkerEnv } from './env.js';

const env = loadWorkerEnv();
const logger = createLogger({ service: 'worker', level: env.LOG_LEVEL });

const db = await createDatabaseClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
redis.on('error', (err) => logger.error({ err }, 'Redis error'));

const registry = new ModuleRegistry(modules);
const i18n = new I18n(env.DEFAULT_LOCALE);
registerCoreLocales(i18n);
registry.registerLocales(i18n);

const config = new ConfigService({
  registry,
  store: new PrismaConfigStore(db),
  sharedCache: new RedisConfigCache(redis),
  publish: (message) => publishConfigInvalidation(redis, message),
  logger,
});
const unsubscribeConfig = await subscribeConfigInvalidation(redis, logger, (message) => config.invalidate(message));

const services: CoreServices = {
  logger,
  db,
  redis,
  i18n,
  bus: new EventBus(logger),
  config,
  scheduler: new Scheduler(db),
  rest: new REST().setToken(env.DISCORD_TOKEN),
};

const jobs = new JobRunner(services, registry);
const intervals = new IntervalRunner(services, registry);
jobs.start(env.WORKER_POLL_MS);
intervals.start();

const health = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }));
  } else {
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
