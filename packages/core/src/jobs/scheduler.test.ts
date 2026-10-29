import type { PrismaClient } from '@bot/db';
import { describe, expect, it } from 'vitest';
import { Scheduler } from './scheduler.js';

function setup() {
  type Row = { id: string; key: string | null; lockedUntil: Date | null; doneAt: Date | null; runAt: Date; [key: string]: unknown };
  const rows: Row[] = [];
  let beforeCreate: (() => void) | undefined;
  let conflicts = 0;
  let transactions = 0;
  const actions = {
    create: async ({ data }: { data: Omit<Row, 'id'> }) => {
      beforeCreate?.();
      beforeCreate = undefined;
      if (conflicts-- > 0) throw Object.assign(new Error('Unique key race'), { code: 'P2002' });
      const made = { ...data, id: String(rows.length + 1) } as Row;
      rows.push(made);
      return made;
    },
    updateMany: async ({ where }: { where: { key: string } }) => {
      const matching = rows.filter((r) => r.key === where.key);
      for (const row of matching) { row.key = null; row.doneAt = new Date(); }
      return { count: matching.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
  };
  const db = { scheduledAction: actions, $transaction: async <T>(fn: (tx: { scheduledAction: typeof actions }) => Promise<T>) => {
    transactions++;
    const saved = structuredClone(rows);
    try { return await fn({ scheduledAction: actions }); }
    catch (err) { rows.splice(0, rows.length, ...saved); throw err; }
  } };
  const scheduler = new Scheduler(db as unknown as PrismaClient);
  const schedule = (runAt = new Date()) => scheduler.schedule({ guildId: 'guild', moduleId: 'messages', job: 'scheduled', payload: { id: 'message' }, runAt, key: 'messages:scheduled:message' });
  return { rows, scheduler, schedule, interleave: (fn: () => void) => { beforeCreate = fn; }, conflict: (n: number) => { conflicts = n; }, transactions: () => transactions };
}

describe('keyed job successors', () => {
  it('preserves the successor after the current handler completes', async () => {
    const { rows, scheduler, schedule } = setup();
    const first = await schedule();
    rows[0]!.attempts = 1;
    rows[0]!.lockedUntil = new Date(Date.now() + 60_000);
    const next = await schedule(new Date(Date.now() + 3_600_000));
    await scheduler.complete(first.id);
    expect(next.id).not.toBe(first.id);
    expect(rows[0]!.doneAt).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ key: 'messages:scheduled:message', doneAt: null });
  });

  it('retires an old retry before replacing its schedule', async () => {
    const { rows, scheduler, schedule } = setup();
    const first = await schedule();
    rows[0]!.attempts = 1;
    await scheduler.fail(first.id, 'temporary failure', new Date(Date.now() - 1000));
    const next = await schedule();
    expect(next.id).not.toBe(first.id);
    expect(rows[0]!.doneAt).toBeInstanceOf(Date);
    expect(rows.filter((row) => row.doneAt === null)).toEqual([rows[1]]);
  });

  it('does not revive a superseded handler when it fails or finishes after timeout', async () => {
    const { rows, scheduler, schedule } = setup();
    const first = await schedule();
    rows[0]!.attempts = 1;
    await scheduler.fail(first.id, 'timeout', new Date(Date.now() + 60_000));
    const next = await schedule();
    await scheduler.fail(first.id, 'late failure', new Date(Date.now() - 1000));
    expect(rows[0]!.doneAt).toBeInstanceOf(Date);
    await scheduler.complete(first.id);
    expect(rows.find((row) => row.id === next.id)).toMatchObject({ doneAt: null, lastError: null });
  });

  it('replaces pending jobs with one runnable keyed successor', async () => {
    const { rows, schedule } = setup();
    const first = await schedule();
    const next = await schedule();
    expect(next.id).not.toBe(first.id);
    expect(rows.filter((row) => row.doneAt === null && row.key === 'messages:scheduled:message')).toEqual([rows[1]]);
  });

  it('prevents a stale candidate claim between retiring a pending row and creating its successor', async () => {
    const { rows, scheduler, schedule, interleave } = setup();
    const first = await schedule();
    const candidate = { id: first.id, lockedUntil: null };
    let claimed = false;
    interleave(() => {
      const row = rows.find((r) => r.id === candidate.id && r.doneAt === null && r.lockedUntil === candidate.lockedUntil);
      if (row) { claimed = true; row.lockedUntil = new Date(Date.now() + 60_000); }
    });
    const next = await schedule();
    expect(claimed).toBe(false);
    await scheduler.complete(first.id);
    expect(rows.find((row) => row.id === next.id)).toMatchObject({ doneAt: null });
  });

  it('retries a unique-key race with the entire replacement transaction', async () => {
    const { schedule, conflict, transactions, rows } = setup();
    await schedule();
    conflict(1);
    await schedule();
    expect(transactions()).toBe(3);
    expect(rows.filter((row) => row.doneAt === null)).toHaveLength(1);
  });

  it('bounds retries when the key keeps conflicting', async () => {
    const { schedule, conflict, transactions } = setup();
    conflict(3);
    await expect(schedule()).rejects.toMatchObject({ code: 'P2002' });
    expect(transactions()).toBe(3);
  });
});
