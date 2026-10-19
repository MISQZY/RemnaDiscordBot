import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@bot/db';
import { sqliteUrl } from '@bot/db/sqlite-tools';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** SQLite-файл с применённой схемой; создаётся в global setup. */
    sqliteTemplatePath: string;
  }
}

export interface TestDatabase {
  db: PrismaClient;
  url: string;
  cleanup(): Promise<void>;
}

// Клиент генерируется в global setup, поэтому импортируется динамически и без статических типов.
const SQLITE_CLIENT = '@bot/db/sqlite';

/**
 * Отдельная SQLite-база для тестового файла: копия шаблона со схемой.
 * Клиент приводится к типу Postgres-клиента — схемы совпадают, отличается только провайдер.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const dir = await mkdtemp(join(tmpdir(), 'bot-test-db-'));
  const file = join(dir, 'test.db');
  await copyFile(inject('sqliteTemplatePath'), file);

  const url = sqliteUrl(file);
  const { PrismaClient: SqliteClient } = (await import(SQLITE_CLIENT)) as {
    PrismaClient: new (options: { datasourceUrl: string }) => PrismaClient;
  };
  const db = new SqliteClient({ datasourceUrl: url });

  return {
    db,
    url,
    async cleanup() {
      await db.$disconnect();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
