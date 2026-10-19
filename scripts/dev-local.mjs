// Local run without Postgres, Redis or containers:
// a SQLite file in .local/ and a shared in-memory Redis server for the bot, the worker and the API.
// SQLite data survives restarts, Redis data (sessions, cache) does not.
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

// .env values reach child processes via --env-file; here they are only used for checks.
const envFile = resolve(root, '.env');
const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const setting = (name) => process.env[name] || fileEnv[name] || undefined;

mkdirSync(dirname(dbFile), { recursive: true });
generate();
push(dbFile);

const redis = await startMemoryRedisServer({ port: redisPort }).catch((err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  // The usual cause is another dev:local instance that is still running.
  process.stderr.write(`Port ${redisPort} is busy: dev:local seems to be running already. Stop it first or set LOCAL_REDIS_PORT.\n`);
  process.exit(1);
});

// Environment variables take precedence over .env (--env-file does not override them).
const env = {
  ...process.env,
  DATABASE_URL: sqliteUrl(dbFile),
  REDIS_URL: redis.url,
  TOTAL_SHARDS: '1',
  SHARDS_PER_CLUSTER: '1',
  // Sessions live only in memory anyway, so a random per-run secret is safe.
  SESSION_SECRET: setting('SESSION_SECRET') ?? randomBytes(32).toString('base64url'),
};

const apps = [
  { name: 'bot', dir: 'apps/bot' },
  { name: 'worker', dir: 'apps/worker' },
];
if (setting('DISCORD_CLIENT_SECRET')) apps.push({ name: 'api', dir: 'apps/api' });
else process.stdout.write('DISCORD_CLIENT_SECRET is not set in .env — starting without the API.\n');

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
