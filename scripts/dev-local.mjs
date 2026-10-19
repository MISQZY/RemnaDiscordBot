// Локальный запуск без Postgres, Redis и контейнеров:
// SQLite-файл в .local/ и общий in-memory Redis-сервер для всех приложений.
// Данные SQLite сохраняются между запусками, данные Redis — нет.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, push, sqliteUrl } from '@bot/db/sqlite-tools';
import { startMemoryRedisServer } from '@bot/testing/redis-server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = resolve(root, '.local/dev.db');
const redisPort = Number(process.env.LOCAL_REDIS_PORT ?? 6390);

mkdirSync(dirname(dbFile), { recursive: true });
generate();
push(dbFile);

const redis = await startMemoryRedisServer({ port: redisPort });
process.stdout.write(`Local Redis: ${redis.url}\nLocal database: ${dbFile}\n`);

// Значения окружения имеют приоритет над .env (--env-file их не перезаписывает).
const env = {
  ...process.env,
  DATABASE_URL: sqliteUrl(dbFile),
  REDIS_URL: redis.url,
  TOTAL_SHARDS: '1',
  SHARDS_PER_CLUSTER: '1',
};

const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const apps = [{ name: 'bot', dir: 'apps/bot', entry: 'src/index.ts' }];

const children = apps.map(({ dir, entry }) =>
  spawn(
    process.execPath,
    [tsx, 'watch', '--conditions=development', '--env-file-if-exists=../../.env', entry],
    { cwd: resolve(root, dir), stdio: 'inherit', env },
  ),
);

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  await redis.close();
  process.exit(code);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
for (const child of children) child.on('exit', (code) => void stop(code ?? 0));
