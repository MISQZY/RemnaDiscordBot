import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@bot/db';
import { sqliteUrl } from '@bot/db/sqlite-tools';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** SQLite file with the schema applied; created in global setup. */
    sqliteTemplatePath: string;
  }
}

export interface TestDatabase {
  db: PrismaClient;
  url: string;
  cleanup(): Promise<void>;
}

// The client is generated in global setup, so it is imported dynamically and without static types.
const SQLITE_CLIENT = '@bot/db/sqlite';

/**
 * A separate SQLite database per test file: a copy of the template with the schema.
 * The client is cast to the Postgres client type — the schemas match, only the provider differs.
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
