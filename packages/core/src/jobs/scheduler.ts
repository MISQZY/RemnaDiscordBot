import type { Prisma, PrismaClient, ScheduledAction } from '@bot/db';

export interface ScheduleRequest {
  guildId: string;
  moduleId: string;
  job: string;
  payload: unknown;
  runAt: Date;
  /** Scheduling again with the same key replaces the pending job; the key is also used to cancel. */
  key?: string;
}

export interface ClaimOptions {
  limit: number;
  lockMs: number;
  maxAttempts: number;
}

/**
 * Scheduled actions on top of the `ScheduledAction` table — works on both Postgres and SQLite.
 * Claiming is a compare-and-swap on `lockedUntil`, so several workers never take the same job.
 */
export class Scheduler {
  constructor(private readonly db: PrismaClient) {}

  async schedule({ guildId, moduleId, job, payload, runAt, key }: ScheduleRequest): Promise<ScheduledAction> {
    const data = {
      guildId,
      type: `${moduleId}:${job}`,
      payload: payload as Prisma.InputJsonValue,
      runAt,
      doneAt: null,
      lockedUntil: null,
      attempts: 0,
      lastError: null,
    };
    if (!key) return this.db.scheduledAction.create({ data });
    return this.db.scheduledAction.upsert({ where: { key }, create: { ...data, key }, update: data });
  }

  /** Cancels a job that has not run yet. Returns whether it existed. */
  async cancel(key: string): Promise<boolean> {
    const { count } = await this.db.scheduledAction.deleteMany({ where: { key, doneAt: null } });
    return count > 0;
  }

  async claimDue({ limit, lockMs, maxAttempts }: ClaimOptions): Promise<ScheduledAction[]> {
    const now = new Date();
    const candidates = await this.db.scheduledAction.findMany({
      where: {
        doneAt: null,
        runAt: { lte: now },
        attempts: { lt: maxAttempts },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      orderBy: { runAt: 'asc' },
      take: limit,
      select: { id: true, lockedUntil: true },
    });

    const claimed: string[] = [];
    for (const candidate of candidates) {
      const { count } = await this.db.scheduledAction.updateMany({
        where: { id: candidate.id, doneAt: null, lockedUntil: candidate.lockedUntil },
        data: { lockedUntil: new Date(now.getTime() + lockMs), attempts: { increment: 1 } },
      });
      if (count === 1) claimed.push(candidate.id);
    }
    if (claimed.length === 0) return [];
    return this.db.scheduledAction.findMany({ where: { id: { in: claimed } }, orderBy: { runAt: 'asc' } });
  }

  /** Jobs still waiting longer than `graceMs` after their run time — workers are down or cannot keep up. */
  async countOverdue(graceMs: number, maxAttempts: number): Promise<number> {
    return this.db.scheduledAction.count({
      where: { doneAt: null, attempts: { lt: maxAttempts }, runAt: { lt: new Date(Date.now() - graceMs) } },
    });
  }

  async complete(id: string): Promise<void> {
    await this.db.scheduledAction.update({ where: { id }, data: { doneAt: new Date(), lockedUntil: null, lastError: null } });
  }

  /** Failure: retry at `retryAt` or, when `null`, give up for good (`doneAt` + `lastError`). */
  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    await this.db.scheduledAction.update({
      where: { id },
      data: retryAt
        ? { runAt: retryAt, lockedUntil: null, lastError: error }
        : { doneAt: new Date(), lockedUntil: null, lastError: error },
    });
  }
}
