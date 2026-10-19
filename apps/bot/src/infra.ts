import { createRequire } from 'node:module';
import { createPrismaClient, type PrismaClient } from '@bot/db';
import { Redis } from 'ioredis';

/** Локальный режим (`pnpm dev:local`) использует SQLite-файл и Redis в памяти процесса. */
export const isLocalDatabase = (url: string) => url.startsWith('file:');
export const isMemoryRedis = (url: string) => url.startsWith('memory://');

export async function createDatabase(url: string): Promise<PrismaClient> {
  if (!isLocalDatabase(url)) return createPrismaClient({ url });

  // SQLite-клиент генерируется скриптом dev:local, поэтому без статического импорта.
  const specifier = '@bot/db/sqlite';
  const { PrismaClient: SqliteClient } = (await import(specifier)) as {
    PrismaClient: new (options: { datasourceUrl: string }) => PrismaClient;
  };
  return new SqliteClient({ datasourceUrl: url });
}

export function createRedis(url: string): Redis {
  if (!isMemoryRedis(url)) return new Redis(url, { maxRetriesPerRequest: 3 });

  const RedisMock = createRequire(import.meta.url)('ioredis-mock') as new () => Redis;
  return new RedisMock();
}
