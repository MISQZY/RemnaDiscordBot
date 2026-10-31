import {
  bootstrapServices,
  Dispatcher,
  EventBus,
  Scheduler,
} from '@bot/core';
import { isSqliteUrl } from '@bot/db';
import { GuildSnapshotWriter } from '@bot/discord';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { ClusterClient, getInfo } from 'discord-hybrid-sharding';
import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import { Redis } from 'ioredis';
import { loadClusterEnv } from './env.js';
import { RedisIdentifyThrottler } from './identify.js';
import { GuildLifecycle } from './lifecycle/guilds.js';
import { startHeartbeat } from './lifecycle/heartbeat.js';
import { registerClusterMetrics } from './metrics.js';
import { startLeaseGuard } from './orchestration/guard.js';
import { coordinationRedisOptions } from './orchestration/store.js';

const env = loadClusterEnv();
const info = getInfo();
const logger = createLogger({ service: 'bot', level: env.LOG_LEVEL, bindings: { clusterId: info.CLUSTER } });
let stopLeaseGuard: (() => void) | undefined;
let leaseRedis: Redis | undefined;
if (process.env.SHARD_MODE === 'dynamic') {
  const token = process.env.SHARD_LEASE_TOKEN;
  if (!token) throw new Error('Dynamic cluster started without an ownership token');
  leaseRedis = new Redis(env.REDIS_URL, { ...coordinationRedisOptions(), lazyConnect: true });
  leaseRedis.on('error', (err) => logger.warn({ err }, 'Lease Redis unavailable'));
  await leaseRedis.connect();
  const revoke = () => {
    logger.fatal({ clusterId: info.CLUSTER }, 'Cluster ownership lost; exiting immediately');
    process.exit(1);
  };
  process.once('disconnect', revoke);
  stopLeaseGuard = await startLeaseGuard(leaseRedis, info.CLUSTER, token, revoke);
}

const { db, redis, registry, i18n, guildLocales, config, close: closeBootstrap } = await bootstrapServices({
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  defaultLocale: env.DEFAULT_LOCALE,
  modules,
  logger,
});
if (isSqliteUrl(env.DATABASE_URL)) {
  logger.warn('Local mode: SQLite database, single cluster only');
}

const client = new Client({
  intents: registry.intents([GatewayIntentBits.Guilds, GatewayIntentBits.GuildExpressions]),
  partials: registry.partials(),
  shards: info.SHARD_LIST,
  shardCount: info.TOTAL_SHARDS,
  // Messages, presences and reactions are not cached: the data modules need lives in Redis. Users are capped and swept:
  // every author and reacting member would otherwise stay in memory for as long as the process runs.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    GuildMemberManager: { maxSize: 200, keepOverLimit: (member) => member.id === member.client.user.id },
    UserManager: { maxSize: 10_000, keepOverLimit: (user) => user.id === user.client.user.id },
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    users: { interval: 3600, filter: () => (user) => user.id !== user.client.user.id },
  },
  allowedMentions: { parse: ['users'] },
  // Identifies take turns through Redis: the clusters of other servers share the same rate limit.
  ws: {
    buildIdentifyThrottler: async (manager) => {
      const gateway = await manager.fetchGatewayInformation();
      return new RedisIdentifyThrottler(redis, gateway.session_start_limit.max_concurrency, logger);
    },
  },
});
client.cluster = new ClusterClient(client);
registerClusterMetrics(client, info.CLUSTER);

const bus = new EventBus(logger);
const scheduler = new Scheduler(db);
const dispatcher = new Dispatcher({ client, logger, db, redis, i18n, bus, config, scheduler, guildLocales, rest: client.rest, registry }, registry);
dispatcher.attach();
const teardownModules = await dispatcher.setupModules();
new GuildLifecycle(db, new GuildSnapshotWriter(redis), logger).attach(client);
const stopHeartbeat = startHeartbeat(client, redis, logger, {
  clusterId: info.CLUSTER, shards: info.SHARD_LIST,
  nodeId: process.env.SHARD_MODE === 'dynamic' ? process.env.SHARD_NODE_ID : undefined,
  intervalMs: process.env.SHARD_MODE === 'dynamic' ? 5_000 : undefined,
});

client.once(Events.ClientReady, (ready) => {
  client.cluster.triggerReady();
  logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size, shards: info.SHARD_LIST }, 'Cluster ready');
});
client.on(Events.Error, (err) => logger.error({ err }, 'Client error'));
client.on(Events.ShardError, (err, shardId) => logger.error({ err, shardId }, 'Shard error'));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Cluster shutting down');
  try {
    await stopHeartbeat();
    await teardownModules();
    await client.destroy();
    await closeBootstrap();
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  } finally {
    stopLeaseGuard?.();
    leaseRedis?.disconnect();
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

await client.login(env.DISCORD_TOKEN);
