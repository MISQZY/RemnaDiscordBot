import { createServer } from 'node:http';
import {
  bootstrapServices,
  EventBus,
  IntervalRunner,
  JobRunner,
  Scheduler,
  handleMetricsRequest,
  type CoreServices,
} from '@bot/core';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { REST } from 'discord.js';
import { Gauge, collectDefaultMetrics } from 'prom-client';
import { loadWorkerEnv } from './env.js';
import { startMaintenance } from './maintenance.js';

const env = loadWorkerEnv();
const logger = createLogger({ service: 'worker', level: env.LOG_LEVEL });
collectDefaultMetrics();

/** A job counts as overdue once it waits this long past its run time. */
const OVERDUE_GRACE_MS = 60_000;
const MAX_ATTEMPTS = 5;

const { db, redis, registry, i18n, guildLocales, config, close: closeBootstrap } = await bootstrapServices({
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  defaultLocale: env.DEFAULT_LOCALE,
  modules,
  logger,
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
const stopMaintenance = startMaintenance(services, { retentionDays: env.GUILD_DATA_RETENTION_DAYS, jobHistoryDays: env.JOB_HISTORY_DAYS });

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
    stopMaintenance();
    await jobs.stop();
    health.close();
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
