import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleRegistry } from '@bot/core';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { ClusterManager } from 'discord-hybrid-sharding';
import { REST } from 'discord.js';
import { collectCommandPayloads, syncCommands } from './commands.js';
import { loadManagerEnv } from './env.js';
import { startHealthServer } from './health.js';
import { aggregateMetrics, registerManagerMetrics } from './metrics.js';
import { hostShards } from './sharding.js';
import { DynamicRuntime } from './orchestration/runtime.js';

const env = loadManagerEnv();
const logger = createLogger({ service: 'bot-manager', level: env.LOG_LEVEL });

// In dev the process runs from .ts via tsx, in production from the built .js.
const clusterFile = fileURLToPath(new URL(`./cluster${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

// On several servers each manager runs its own range of the clusters; alone, it runs them all.
const share =
  env.SHARD_MODE === 'static' && env.SHARD_HOSTS > 1 && env.TOTAL_SHARDS !== 'auto'
    ? hostShards({ totalShards: env.TOTAL_SHARDS, shardsPerCluster: env.SHARDS_PER_CLUSTER, hosts: env.SHARD_HOSTS, hostIndex: env.SHARD_HOST_INDEX })
    : undefined;

const manager = new ClusterManager(clusterFile, {
  token: env.DISCORD_TOKEN,
  totalShards: env.TOTAL_SHARDS,
  ...(env.SHARD_MODE === 'dynamic' && typeof env.TOTAL_SHARDS === 'number'
    ? { totalClusters: Math.ceil(env.TOTAL_SHARDS / env.SHARDS_PER_CLUSTER) }
    : {}),
  shardsPerClusters: env.SHARDS_PER_CLUSTER,
  ...share,
  mode: 'process',
  // Clusters inherit node flags (tsx loader, --conditions, --env-file).
  execArgv: process.execArgv,
  respawn: env.SHARD_MODE === 'static',
  restarts: { max: 5, interval: 60 * 60_000 },
});
const dynamic = env.SHARD_MODE === 'dynamic' && typeof env.TOTAL_SHARDS === 'number'
  ? new DynamicRuntime(manager, {
    totalShards: env.TOTAL_SHARDS, shardsPerCluster: env.SHARDS_PER_CLUSTER,
    nodeId: env.SHARD_NODE_ID!, redisUrl: env.REDIS_URL!,
    memoryBytes: env.SHARD_NODE_MEMORY_MB * 1024 * 1024,
    cpuCores: env.SHARD_NODE_CPU_CORES, maxClusters: env.SHARD_NODE_MAX_CLUSTERS,
  }, logger)
  : undefined;
manager.on('error', (err: unknown) => logger.error({ err }, 'Cluster manager error'));

manager.on('clusterCreate', (cluster) => {
  logger.info({ clusterId: cluster.id }, 'Cluster launched');
  cluster.on('death', () => logger.warn({ clusterId: cluster.id }, 'Cluster died'));
});

registerManagerMetrics(manager);
const health = startHealthServer(
  env.BOT_HEALTH_PORT,
  {
    getClusters: () => [...manager.clusters.values()].map((c) => ({ id: c.id, ready: c.ready })),
    getMetrics: () => aggregateMetrics(manager, logger),
    metricsToken: env.METRICS_TOKEN,
    managerReady: dynamic ? () => dynamic.healthy : undefined,
  },
  logger,
);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down clusters');
  health.close();
  if (dynamic) {
    void dynamic.stop().catch((err: unknown) => logger.error({ err }, 'Dynamic shutdown failed')).finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
    return;
  }
  for (const cluster of manager.clusters.values()) cluster.kill({ force: false, reason: 'shutdown' });
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (env.AUTO_DEPLOY_COMMANDS && env.SHARD_HOST_INDEX === 0) {
  // Once in the first server's manager, not in every cluster. A sync failure does not block startup.
  try {
    const result = await syncCommands(new REST().setToken(env.DISCORD_TOKEN), collectCommandPayloads(new ModuleRegistry(modules)), {
      guildId: env.DISCORD_DEV_GUILD_ID,
      logger,
    });
    logger.info(result, 'Slash commands synced');
  } catch (err) {
    logger.error({ err }, 'Slash command sync failed');
  }
}

if (dynamic) {
  await dynamic.start();
  logger.info({ node: env.SHARD_NODE_ID }, 'Dynamic sharding manager started');
} else {
  await manager.spawn({ timeout: -1 });
  logger.info(
    { clusters: manager.clusters.size, shards: manager.totalShards, host: env.SHARD_HOST_INDEX, hosts: env.SHARD_HOSTS },
    'All clusters spawned',
  );
}
