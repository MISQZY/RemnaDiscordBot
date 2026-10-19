import type { Prisma, PrismaClient } from '@bot/db';

export interface AuditRecord {
  guildId: string;
  userId: string;
  moduleId?: string;
  /** `guild.update`, `module.update`, `module.reset`, … */
  action: string;
  diff?: { before: unknown; after: unknown };
}

/** History of changes made through the dashboard — shown by the web app. */
export async function recordAudit(db: PrismaClient, record: AuditRecord): Promise<void> {
  await db.dashboardAuditLog.create({
    data: {
      guildId: record.guildId,
      userId: record.userId,
      moduleId: record.moduleId ?? null,
      action: record.action,
      diff: (record.diff ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
