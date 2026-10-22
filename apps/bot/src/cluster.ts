import {
  ConfigService,
  Dispatcher,
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
import { createDatabaseClient, isSqliteUrl } from '@bot/db';
import { GuildSnapshotWriter } from '@bot/discord';
import { I18n } from '@bot/i18n';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { ClusterClient, getInfo } from 'discord-hybrid-sharding';
import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import { Redis } from 'ioredis';
import { loadClusterEnv } from './env.js';
import { GuildLifecycle } from './lifecycle/guilds.js';
import { startHeartbeat } from './lifecycle/heartbeat.js';
import { registerClusterMetrics } from './metrics.js';

const env = loadClusterEnv();
const info = getInfo();
const logger = createLogger({ service: 'bot', level: env.LOG_LEVEL, bindings: { clusterId: info.CLUSTER } });

const registry = new ModuleRegistry(modules);

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
});
client.cluster = new ClusterClient(client);
registerClusterMetrics(client, info.CLUSTER);

const db = await createDatabaseClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
redis.on('error', (err) => logger.error({ err }, 'Redis error'));
if (isSqliteUrl(env.DATABASE_URL)) {
  logger.warn('Local mode: SQLite database, single cluster only');
}

const i18n = new I18n(env.DEFAULT_LOCALE);
registerCoreLocales(i18n);
registry.registerLocales(i18n);

const bus = new EventBus(logger);
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

const scheduler = new Scheduler(db);
const dispatcher = new Dispatcher({ client, logger, db, redis, i18n, bus, config, scheduler, guildLocales, rest: client.rest, registry }, registry);
dispatcher.attach();
const teardownModules = await dispatcher.setupModules();
new GuildLifecycle(db, new GuildSnapshotWriter(redis), logger).attach(client);
const stopHeartbeat = startHeartbeat(client, redis, logger, { clusterId: info.CLUSTER, shards: info.SHARD_LIST });

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

await client.login(env.DISCORD_TOKEN);
