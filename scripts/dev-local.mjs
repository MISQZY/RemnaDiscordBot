// Локальный запуск без Postgres, Redis и контейнеров:
// SQLite-файл в .local/ и общий in-memory Redis-сервер для бота и API.
// Данные SQLite сохраняются между запусками, данные Redis (сессии, кэш) — нет.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { generate, push, sqliteUrl } from '@bot/db/sqlite-tools';
import { startMemoryRedisServer } from '@bot/testing/redis-server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = resolve(root, '.local/dev.db');
const redisPort = Number(process.env.LOCAL_REDIS_PORT ?? 6390);

// Значения из .env видны дочерним процессам через --env-file; здесь — только для проверок.
const envFile = resolve(root, '.env');
const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const setting = (name) => process.env[name] || fileEnv[name] || undefined;

mkdirSync(dirname(dbFile), { recursive: true });
generate();
push(dbFile);

const redis = await startMemoryRedisServer({ port: redisPort });

// Переменные окружения имеют приоритет над .env (--env-file их не перезаписывает).
const env = {
  ...process.env,
  DATABASE_URL: sqliteUrl(dbFile),
  REDIS_URL: redis.url,
  TOTAL_SHARDS: '1',
  SHARDS_PER_CLUSTER: '1',
  // Сессии всё равно живут только в памяти, поэтому случайный секрет на запуск безопасен.
  SESSION_SECRET: setting('SESSION_SECRET') ?? randomBytes(32).toString('base64url'),
};

const apps = [{ name: 'bot', dir: 'apps/bot' }];
if (setting('DISCORD_CLIENT_SECRET')) apps.push({ name: 'api', dir: 'apps/api' });
else process.stdout.write('DISCORD_CLIENT_SECRET is not set in .env — starting the bot only, without the API.\n');

process.stdout.write(`Local Redis: ${redis.url}\nLocal database: ${dbFile}\nApps: ${apps.map((a) => a.name).join(', ')}\n`);

const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const children = apps.map(({ dir }) =>
  spawn(
    process.execPath,
    [tsx, 'watch', '--conditions=development', '--env-file-if-exists=../../.env', 'src/index.ts'],
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
