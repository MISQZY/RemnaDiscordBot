import type { Prisma, PrismaClient, ScheduledAction } from '@bot/db';

export interface ScheduleRequest {
  guildId: string;
  moduleId: string;
  job: string;
  payload: unknown;
  runAt: Date;
  /** Повторное планирование с тем же ключом заменяет ожидающую задачу; по ключу же отмена. */
  key?: string;
}

export interface ClaimOptions {
  limit: number;
  lockMs: number;
  maxAttempts: number;
}

/**
 * Отложенные действия поверх таблицы `ScheduledAction` — работает и на Postgres, и на SQLite.
 * Захват — compare-and-swap по `lockedUntil`, поэтому несколько воркеров не возьмут одну задачу.
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

  /** Отменяет ещё не выполненную задачу. Возвращает, была ли она. */
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

  async complete(id: string): Promise<void> {
    await this.db.scheduledAction.update({ where: { id }, data: { doneAt: new Date(), lockedUntil: null, lastError: null } });
  }

  /** Ошибка: повтор в `retryAt` или, если `null`, окончательный отказ (`doneAt` + `lastError`). */
  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    await this.db.scheduledAction.update({
      where: { id },
      data: retryAt
        ? { runAt: retryAt, lockedUntil: null, lastError: error }
        : { doneAt: new Date(), lockedUntil: null, lastError: error },
    });
  }
}
