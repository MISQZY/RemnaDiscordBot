import { PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient } from '@prisma/client';
export type {
  CustomCommand,
  DashboardAuditLog,
  DashboardUser,
  Guild,
  GuildModuleConfig,
  InfoPanel,
  MemberLevel,
  MemberRoleBackup,
  ModCase,
  ModCaseCounter,
  NotificationSource,
  NotificationSubscription,
  RolePanel,
  ScheduledAction,
} from '@prisma/client';

export interface CreatePrismaClientOptions {
  url?: string;
  logQueries?: boolean;
}

export function createPrismaClient({ url, logQueries = false }: CreatePrismaClientOptions = {}): PrismaClient {
  return new PrismaClient({
    ...(url ? { datasourceUrl: url } : {}),
    log: logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/** `file:…` — a local SQLite database (dev:local mode), otherwise Postgres. */
export const isSqliteUrl = (url: string) => url.startsWith('file:');

/**
 * Client by URL: Postgres or the SQLite client for local mode.
 * The schemas match and only the provider differs, so the type is shared.
 */
export async function createDatabaseClient(url: string): Promise<PrismaClient> {
  if (!isSqliteUrl(url)) return createPrismaClient({ url });

  // The SQLite client is generated separately (`pnpm db:sqlite`), hence no static import.
  const specifier = '@bot/db/sqlite';
  const { PrismaClient: SqliteClient } = (await import(specifier)) as {
    PrismaClient: new (options: { datasourceUrl: string }) => PrismaClient;
  };
  return new SqliteClient({ datasourceUrl: url });
}

/**
 * Unique constraint violation (P2002). Checked by code rather than `instanceof`:
 * the Postgres and SQLite clients have different error classes.
 */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}
