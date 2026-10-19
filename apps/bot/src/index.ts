import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@bot/logger';
import { ClusterManager } from 'discord-hybrid-sharding';
import { loadManagerEnv } from './env.js';
import { startHealthServer } from './health.js';

const env = loadManagerEnv();
const logger = createLogger({ service: 'bot-manager', level: env.LOG_LEVEL });

// В dev процесс запущен из .ts через tsx, в проде — из собранного .js.
const clusterFile = fileURLToPath(new URL(`./cluster${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

const manager = new ClusterManager(clusterFile, {
  token: env.DISCORD_TOKEN,
  totalShards: env.TOTAL_SHARDS,
  shardsPerClusters: env.SHARDS_PER_CLUSTER,
  mode: 'process',
  // Кластеры наследуют флаги node (загрузчик tsx, --conditions, --env-file).
  execArgv: process.execArgv,
  respawn: true,
  restarts: { max: 5, interval: 60 * 60_000 },
});

manager.on('clusterCreate', (cluster) => {
  logger.info({ clusterId: cluster.id }, 'Cluster launched');
  cluster.on('death', () => logger.warn({ clusterId: cluster.id }, 'Cluster died'));
});

const health = startHealthServer(
  env.BOT_HEALTH_PORT,
  () => [...manager.clusters.values()].map((c) => ({ id: c.id, ready: c.ready })),
  logger,
);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down clusters');
  health.close();
  for (const cluster of manager.clusters.values()) cluster.kill({ force: false, reason: 'shutdown' });
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await manager.spawn({ timeout: -1 });
logger.info({ clusters: manager.clusters.size, shards: manager.totalShards }, 'All clusters spawned');
