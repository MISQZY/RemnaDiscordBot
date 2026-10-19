import { PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient } from '@prisma/client';
export type {
  DashboardAuditLog,
  DashboardUser,
  Guild,
  GuildModuleConfig,
  MemberRoleBackup,
  ModCase,
  ModCaseCounter,
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

/** `file:…` — локальная SQLite-база (режим dev:local), иначе Postgres. */
export const isSqliteUrl = (url: string) => url.startsWith('file:');

/**
 * Клиент по URL: Postgres или SQLite-клиент для локального режима.
 * Схемы совпадают, отличается только провайдер, поэтому тип общий.
 */
export async function createDatabaseClient(url: string): Promise<PrismaClient> {
  if (!isSqliteUrl(url)) return createPrismaClient({ url });

  // SQLite-клиент генерируется отдельно (`pnpm db:sqlite`), поэтому без статического импорта.
  const specifier = '@bot/db/sqlite';
  const { PrismaClient: SqliteClient } = (await import(specifier)) as {
    PrismaClient: new (options: { datasourceUrl: string }) => PrismaClient;
  };
  return new SqliteClient({ datasourceUrl: url });
}
