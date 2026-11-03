import { randomUUID } from 'node:crypto';
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
      lockToken: null,
      attempts: 0,
      lastError: null,
    };
    if (!key) return this.db.scheduledAction.create({ data });
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          // Always retire the old ID: a worker may claim a pending row while it is being replaced.
          await tx.scheduledAction.updateMany({ where: { key }, data: { key: null, doneAt: new Date(), lastError: null, lockToken: null, lockedUntil: null } });
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
    const { count } = await this.db.scheduledAction.updateMany({
      where: { key, doneAt: null },
      data: { key: null, doneAt: new Date(), lastError: null, lockToken: null, lockedUntil: null },
    });
    return count > 0;
  }

  /** Deletes an action by its primary key ID (e.g. permanently removing a failed job). */
  async cancelById(id: string): Promise<boolean> {
    const { count } = await this.db.scheduledAction.deleteMany({ where: { id } });
    return count > 0;
  }

  /** Returns permanently failed jobs (`doneAt IS NOT NULL AND lastError IS NOT NULL`). */
  async findFailed({
    guildId,
    limit = 50,
    cursor,
  }: {
    guildId?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<{ items: ScheduledAction[]; nextCursor: string | null }> {
    const rows = await this.db.scheduledAction.findMany({
      where: {
        doneAt: { not: null },
        lastError: { not: null },
        ...(guildId ? { guildId } : {}),
      },
      orderBy: [{ doneAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  }

  /** Retries a failed job: clears doneAt and lastError, resets attempts and schedules for now. */
  async retry(id: string): Promise<ScheduledAction | null> {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.scheduledAction.updateMany({
        where: { id, doneAt: { not: null }, lastError: { not: null }, lockedUntil: null },
        data: {
          doneAt: null,
          lastError: null,
          attempts: 0,
          runAt: new Date(),
          lockedUntil: null,
          lockToken: null,
        },
      });
      return count === 1 ? tx.scheduledAction.findUnique({ where: { id } }) : null;
    });
  }

  async claimDue({ limit, lockMs, maxAttempts }: ClaimOptions): Promise<ScheduledAction[]> {
    const now = new Date();
    // A worker may have crashed during its last allowed attempt, before it could record a failure.
    await this.db.scheduledAction.updateMany({
      where: { doneAt: null, attempts: { gte: maxAttempts }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { doneAt: now, lockedUntil: null, lockToken: null, lastError: 'Attempt limit reached after the worker lease expired' },
    });
    const candidates = await this.db.scheduledAction.findMany({
      where: {
        doneAt: null,
        runAt: { lte: now },
        attempts: { lt: maxAttempts },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      orderBy: { runAt: 'asc' },
      take: limit,
      select: { id: true, lockedUntil: true, lockToken: true },
    });

    const claimResults = await Promise.all(
      candidates.map(async (candidate) => {
        const lockToken = randomUUID();
        const { count } = await this.db.scheduledAction.updateMany({
          where: { id: candidate.id, doneAt: null, lockedUntil: candidate.lockedUntil, lockToken: candidate.lockToken, attempts: { lt: maxAttempts }, runAt: { lte: now } },
          data: { lockedUntil: new Date(now.getTime() + lockMs), lockToken, attempts: { increment: 1 } },
        });
        return count === 1 ? { id: candidate.id, lockToken } : null;
      }),
    );
    const claimed = claimResults.filter((claim) => claim !== null);
    if (claimed.length === 0) return [];
    return this.db.scheduledAction.findMany({ where: { OR: claimed, doneAt: null }, orderBy: { runAt: 'asc' } });
  }

  /** Jobs still waiting longer than `graceMs` after their run time — workers are down or cannot keep up. */
  async countOverdue(graceMs: number, _maxAttempts: number): Promise<number> {
    return this.db.scheduledAction.count({
      where: { doneAt: null, runAt: { lt: new Date(Date.now() - graceMs) } },
    });
  }

  async renew(id: string, lockToken: string, lockMs: number): Promise<boolean> {
    const { count } = await this.db.scheduledAction.updateMany({
      where: { id, lockToken, doneAt: null, lockedUntil: { gt: new Date() } },
      data: { lockedUntil: new Date(Date.now() + lockMs) },
    });
    return count === 1;
  }

  async noteTimeout(id: string, lockToken: string, message: string): Promise<void> {
    await this.db.scheduledAction.updateMany({ where: { id, lockToken, doneAt: null }, data: { lastError: message } });
  }

  async complete(id: string, lockToken?: string): Promise<void> {
    await this.db.scheduledAction.updateMany({ where: { id, doneAt: null, ...(lockToken !== undefined && { lockToken }) }, data: { doneAt: new Date(), lockedUntil: null, lockToken: null, lastError: null } });
  }

  /** Not run now, on purpose (the module is off): moved to `runAt`, the claim's attempt given back. */
  async postpone(id: string, runAt: Date, lockToken?: string): Promise<void> {
    await this.db.scheduledAction.updateMany({ where: { id, doneAt: null, ...(lockToken !== undefined && { lockToken }) }, data: { runAt, lockedUntil: null, lockToken: null, attempts: { decrement: 1 } } });
  }

  /** Failure: retry at `retryAt` or, when `null`, give up for good (`doneAt` + `lastError`). */
  async fail(id: string, error: string, retryAt: Date | null, lockToken?: string): Promise<void> {
    await this.db.scheduledAction.updateMany({
      where: { id, doneAt: null, ...(lockToken !== undefined && { lockToken }) },
      data: retryAt
        ? { runAt: retryAt, lockedUntil: null, lockToken: null, lastError: error }
        : { doneAt: new Date(), lockedUntil: null, lockToken: null, lastError: error },
    });
  }
}
