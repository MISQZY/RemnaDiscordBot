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
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          // Always retire the old ID: a worker may claim a pending row while it is being replaced.
          await tx.scheduledAction.updateMany({ where: { key }, data: { key: null, doneAt: new Date() } });
          return tx.scheduledAction.create({ data: { ...data, key } });
        });
      } catch (err) {
        // Two first schedules can race on the unique key. Retry the entire replacement transaction.
        const retry = typeof err === 'object' && err !== null && 'code' in err && (err.code === 'P2002' || err.code === 'P2034');
        if (!retry || attempt >= 3) throw err;
      }
    }
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

    const claimResults = await Promise.all(
      candidates.map(async (candidate) => {
        const { count } = await this.db.scheduledAction.updateMany({
          where: { id: candidate.id, doneAt: null, lockedUntil: candidate.lockedUntil },
          data: { lockedUntil: new Date(now.getTime() + lockMs), attempts: { increment: 1 } },
        });
        return count === 1 ? candidate.id : null;
      }),
    );
    const claimed = claimResults.filter((id): id is string => id !== null);
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

  /** Not run now, on purpose (the module is off): moved to `runAt`, the claim's attempt given back. */
  async postpone(id: string, runAt: Date): Promise<void> {
    await this.db.scheduledAction.update({ where: { id }, data: { runAt, lockedUntil: null, attempts: { decrement: 1 } } });
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
