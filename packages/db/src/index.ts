import { PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient } from '@prisma/client';
export type { DashboardAuditLog, DashboardUser, Guild, GuildModuleConfig, ScheduledAction } from '@prisma/client';

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
