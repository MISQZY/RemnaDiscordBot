import {
  ConfigService,
  Dispatcher,
  EventBus,
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

const env = loadClusterEnv();
const info = getInfo();
const logger = createLogger({ service: 'bot', level: env.LOG_LEVEL, bindings: { clusterId: info.CLUSTER } });

const registry = new ModuleRegistry(modules);

const client = new Client({
  intents: registry.intents([GatewayIntentBits.Guilds, GatewayIntentBits.GuildExpressions]),
  partials: registry.partials(),
  shards: info.SHARD_LIST,
  shardCount: info.TOTAL_SHARDS,
  // Сообщения и presence не кэшируем: нужные модулям данные живут в Redis.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    PresenceManager: 0,
    GuildMemberManager: { maxSize: 200, keepOverLimit: (member) => member.id === member.client.user.id },
  }),
  sweepers: Options.DefaultSweeperSettings,
  allowedMentions: { parse: ['users'] },
});
client.cluster = new ClusterClient(client);

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
const config = new ConfigService({
  registry,
  store: new PrismaConfigStore(db),
  sharedCache: new RedisConfigCache(redis),
  publish: (message) => publishConfigInvalidation(redis, message),
  logger,
});
const unsubscribeConfig = await subscribeConfigInvalidation(redis, logger, (message) => config.invalidate(message));

const scheduler = new Scheduler(db);
new Dispatcher({ client, logger, db, redis, i18n, bus, config, scheduler, rest: client.rest }, registry).attach();
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
