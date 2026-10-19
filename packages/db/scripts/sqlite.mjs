// SQLite-вариант схемы для локальных тестов без Postgres.
//   node scripts/sqlite.mjs generate          — схема + клиент в generated/sqlite
//   node scripts/sqlite.mjs push <file.db>    — создать таблицы в файле БД
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'prisma/schema.prisma');
const outDir = resolve(root, 'generated/sqlite');
const target = resolve(outDir, 'schema.prisma');
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** Конструкции Postgres, которых нет в SQLite: их появление в схеме должно ломать тесты сразу. */
const UNSUPPORTED = [
  [/\b(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)\[\]/, 'scalar lists (use Json)'],
  [/@db\./, 'native database types'],
  [/BigInt\s+@id\s+@default\(autoincrement\(\)\)/, 'BigInt autoincrement ids'],
];

function buildSchema() {
  const schema = readFileSync(source, 'utf8');
  for (const [pattern, what] of UNSUPPORTED) {
    if (pattern.test(schema)) throw new Error(`schema.prisma uses ${what}, which SQLite does not support`);
  }
  return schema
    .replace('provider = "postgresql"', 'provider = "sqlite"')
    .replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output   = "./client"');
}

/** Запускает Prisma CLI молча; вывод показывается только при ошибке. */
function prisma(args, env = {}) {
  const result = spawnSync(process.execPath, [prismaCli, ...args, '--schema', target], {
    cwd: root,
    env: { ...process.env, ...env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  }
}

/** Генерирует клиент, если схема изменилась с прошлого раза (или с `force`). */
export function generate({ force = false } = {}) {
  const schema = buildSchema();
  const upToDate =
    existsSync(resolve(outDir, 'client/index.js')) && existsSync(target) && readFileSync(target, 'utf8') === schema;
  if (upToDate && !force) return;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(target, schema);
  prisma(['generate', '--no-hints']);
}

/** `file:C:/…/test.db` на Windows, `file:/tmp/test.db` на Unix — формат, который понимает Prisma. */
export function sqliteUrl(databaseFile) {
  return `file:${resolve(databaseFile).replaceAll('\\', '/')}`;
}

export function push(databaseFile) {
  prisma(['db', 'push', '--skip-generate'], { DATABASE_URL: sqliteUrl(databaseFile) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, file] = process.argv.slice(2);
  if (command === 'generate') generate({ force: process.argv.includes('--force') });
  else if (command === 'push' && file) push(file);
  else {
    process.stderr.write('Usage: sqlite.mjs generate | push <file.db>\n');
    process.exit(1);
  }
}
