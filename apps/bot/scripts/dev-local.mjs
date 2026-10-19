// Запуск бота без Postgres, Redis и контейнеров: SQLite-файл в .local/ и Redis в памяти.
// Данные SQLite сохраняются между запусками, данные Redis (кэш, кулдауны) — нет.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, push, sqliteUrl } from '@bot/db/sqlite-tools';

const botDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = resolve(botDir, '../../.local/dev.db');

mkdirSync(dirname(dbFile), { recursive: true });
generate();
push(dbFile);

const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const child = spawn(
  process.execPath,
  [tsx, 'watch', '--conditions=development', '--env-file-if-exists=../../.env', 'src/index.ts'],
  {
    cwd: botDir,
    stdio: 'inherit',
    // Значения из окружения имеют приоритет над .env.
    env: {
      ...process.env,
      DATABASE_URL: sqliteUrl(dbFile),
      REDIS_URL: 'memory://',
      TOTAL_SHARDS: '1',
      SHARDS_PER_CLUSTER: '1',
    },
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
