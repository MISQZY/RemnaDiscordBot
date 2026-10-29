import { I18n } from '@bot/i18n';
import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import { REST } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EventBus } from '../bus.js';
import { ConfigService } from '../config/service.js';
import { GuildLocales } from '../guild-locales.js';
import { PrismaConfigStore } from '../config/store.js';
import type { CoreServices } from '../context.js';
import { defineModule } from '../module.js';
import { ModuleRegistry } from '../registry.js';
import { testLogger } from '../testing/fixtures.js';
import { IntervalRunner, JobRunner, retryDelayMs } from './runner.js';
import { Scheduler } from './scheduler.js';

const GUILD = '111111111111111111';
const past = () => new Date(Date.now() - 1000);

describe('scheduler and job runner', () => {
  let database: TestDatabase;
  let services: CoreServices;
  const handled: unknown[] = [];
  const failing = vi.fn(async () => {
    throw new Error('Discord is down');
  });
  const flush = vi.fn(async () => {});
  let finishSlow = () => {};
  let finishHang = () => {};
  const slow = vi.fn(() => new Promise<void>((resolve) => (finishSlow = resolve)));

  const module = defineModule({
    id: 'moderation',
    configSchema: z.object({}),
    defaultConfig: {},
    configVersion: 1,
    enabledByDefault: true,
    jobs: {
      unban: async (payload, ctx) => void handled.push({ payload, guildId: ctx.guildId, moduleId: ctx.moduleId }),
      broken: failing,
      hang: () => new Promise<void>((resolve) => (finishHang = resolve)),
    },
    intervals: { flush: { everyMs: 60_000, run: flush }, poll: { everyMs: 1, run: slow } },
  });
  // Off unless a guild turns it on: what becomes of its jobs while it is off.
  const draws = vi.fn(async () => {});
  const giveaways = defineModule({
    id: 'giveaways',
    configSchema: z.object({}),
    defaultConfig: {},
    configVersion: 1,
    jobs: {
      reminder: async () => void handled.push('reminder'),
      end: { whenDisabled: 'postpone', run: draws },
      expire: { whenDisabled: 'run', run: async () => void handled.push('expire') },
    },
  });
  const registry = new ModuleRegistry([module, giveaways]);

  beforeAll(async () => {
    database = await createTestDatabase();
    services = {
      logger: testLogger,
      db: database.db,
      redis: createTestRedis(),
      i18n: new I18n('ru'),
      bus: new EventBus(testLogger),
      config: new ConfigService({ registry, store: new PrismaConfigStore(database.db), logger: testLogger }),
      scheduler: new Scheduler(database.db),
      guildLocales: new GuildLocales(database.db, new I18n('ru')),
      rest: new REST(),
    };
  });

  beforeEach(async () => {
    handled.length = 0;
    await database.db.scheduledAction.deleteMany();
  });

  afterAll(async () => {
    await database.cleanup();
  });

  it('runs due jobs once and marks them done', async () => {
    const runner = new JobRunner(services, registry);
    await services.scheduler.schedule({ guildId: GUILD, moduleId: 'moderation', job: 'unban', payload: { userId: '5' }, runAt: past() });
    await services.scheduler.schedule({
      guildId: GUILD,
      moduleId: 'moderation',
      job: 'unban',
      payload: { userId: '6' },
      runAt: new Date(Date.now() + 60_000),
    });

    expect(await runner.tick()).toBe(1);
    expect(await runner.tick()).toBe(0);
    expect(handled).toEqual([{ payload: { userId: '5' }, guildId: GUILD, moduleId: 'moderation' }]);
    expect(await database.db.scheduledAction.count({ where: { doneAt: { not: null } } })).toBe(1);
  });

  it('skips, postpones or runs the jobs of a disabled module as each job says', async () => {
    const runner = new JobRunner(services, registry);
    const schedule = (job: string) => services.scheduler.schedule({ guildId: GUILD, moduleId: 'giveaways', job, payload: {}, runAt: past() });
    const skipped = await schedule('reminder');
    const postponed = await schedule('end');
    await schedule('expire');

    expect(await runner.tick()).toBe(3);
    expect(handled).toEqual(['expire']);
    expect(draws).not.toHaveBeenCalled();
    expect(await database.db.scheduledAction.findUniqueOrThrow({ where: { id: skipped.id } })).toMatchObject({ doneAt: expect.any(Date) });
    const waiting = await database.db.scheduledAction.findUniqueOrThrow({ where: { id: postponed.id } });
    expect(waiting).toMatchObject({ doneAt: null, attempts: 0, lockedUntil: null });
    expect(waiting.runAt.getTime()).toBeGreaterThan(Date.now());

    await services.config.update(GUILD, 'giveaways', { enabled: true });
    await database.db.scheduledAction.update({ where: { id: postponed.id }, data: { runAt: past() } });
    await runner.tick();
    expect(draws).toHaveBeenCalledOnce();
    await services.config.update(GUILD, 'giveaways', { enabled: false });
  });

  it('keeps a repeating job pending after the previous invocation completes', async () => {
    const key = 'messages:scheduled:regression';
    const repeating = defineModule({
      id: 'messages', configSchema: z.object({}), defaultConfig: {}, configVersion: 1,
      jobs: { scheduled: { whenDisabled: 'run', run: async (_payload, ctx) => {
        await ctx.scheduler.schedule({ guildId: GUILD, moduleId: 'messages', job: 'scheduled', payload: {}, runAt: new Date(Date.now() + 3_600_000), key });
      } } },
    });
    const runner = new JobRunner(services, new ModuleRegistry([repeating]));
    const first = await services.scheduler.schedule({ guildId: GUILD, moduleId: 'messages', job: 'scheduled', payload: {}, runAt: past(), key });
    expect(await runner.tick()).toBe(1);
    const next = await database.db.scheduledAction.findUniqueOrThrow({ where: { key } });
    expect(next.id).not.toBe(first.id);
    expect(next.doneAt).toBeNull();
    expect(next.lockedUntil).toBeNull();
    expect((await database.db.scheduledAction.findUniqueOrThrow({ where: { id: first.id } })).doneAt).not.toBeNull();
    expect(await runner.tick()).toBe(0);
  });

  it('replaces and cancels jobs by key', async () => {
    const schedule = (userId: string) =>
      services.scheduler.schedule({ guildId: GUILD, moduleId: 'moderation', job: 'unban', payload: { userId }, runAt: past(), key: 'unban:5' });
    await schedule('first');
    await schedule('second');

    expect(await database.db.scheduledAction.count({ where: { key: 'unban:5', doneAt: null } })).toBe(1);
    expect(await services.scheduler.cancel('unban:5')).toBe(true);
    expect(await services.scheduler.cancel('unban:5')).toBe(false);
  });

  it('counts jobs overdue past the grace period', async () => {
    const schedule = (runAt: Date) => services.scheduler.schedule({ guildId: GUILD, moduleId: 'moderation', job: 'unban', payload: {}, runAt });
    await schedule(new Date(Date.now() - 5 * 60_000));
    await schedule(past());
    const done = await schedule(new Date(Date.now() - 10 * 60_000));
    await services.scheduler.complete(done.id);

    expect(await services.scheduler.countOverdue(60_000, 5)).toBe(1);
  });

  it('does not let two workers claim the same job', async () => {
    await services.scheduler.schedule({ guildId: GUILD, moduleId: 'moderation', job: 'unban', payload: {}, runAt: past() });
    const options = { limit: 10, lockMs: 60_000, maxAttempts: 5 };

    const [a, b] = await Promise.all([services.scheduler.claimDue(options), services.scheduler.claimDue(options)]);

    expect(a.length + b.length).toBe(1);
  });

  it('retries failed jobs with backoff and gives up after max attempts', async () => {
    const runner = new JobRunner(services, registry, { maxAttempts: 2 });
    const action = await services.scheduler.schedule({ guildId: GUILD, moduleId: 'moderation', job: 'broken', payload: {}, runAt: past() });

    await runner.tick();
    let row = await database.db.scheduledAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(row).toMatchObject({ attempts: 1, doneAt: null, lastError: 'Discord is down' });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());

    await database.db.scheduledAction.update({ where: { id: action.id }, data: { runAt: past() } });
    await runner.tick();
    row = await database.db.scheduledAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(row.attempts).toBe(2);
    expect(row.doneAt).not.toBeNull();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('fails unknown job types permanently', async () => {
    const runner = new JobRunner(services, registry);
    const action = await services.scheduler.schedule({ guildId: GUILD, moduleId: 'missing', job: 'x', payload: {}, runAt: past() });

    await runner.tick();

    expect(await database.db.scheduledAction.findUnique({ where: { id: action.id } })).toMatchObject({
      lastError: 'Unknown job type missing:x',
      doneAt: expect.any(Date),
    });
  });

  it('runs interval tasks once per period across runners', async () => {
    const a = new IntervalRunner(services, registry);
    const b = new IntervalRunner(services, registry);

    expect(await a.runOnce('moderation', 'flush')).toBe(true);
    expect(await b.runOnce('moderation', 'flush')).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
  });

  it('does not start a task again while a run longer than its period goes on', async () => {
    const a = new IntervalRunner(services, registry);
    const b = new IntervalRunner(services, registry);

    const first = a.runOnce('moderation', 'poll');
    await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 5)); // the 1 ms period is over
    expect(await a.runOnce('moderation', 'poll')).toBe(false);
    expect(await b.runOnce('moderation', 'poll')).toBe(false);

    finishSlow();
    expect(await first).toBe(true);
    const next = b.runOnce('moderation', 'poll');
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(2));
    finishSlow();
    expect(await next).toBe(true);
  });

  it('does not retry a timed-out job while it may still run, and counts it done when it finishes late', async () => {
    const runner = new JobRunner(services, registry, { timeoutMs: 20, lockMs: 60_000 });
    const action = await services.scheduler.schedule({ guildId: GUILD, moduleId: 'moderation', job: 'hang', payload: {}, runAt: past() });

    expect(await runner.tick()).toBe(1);
    const failed = await database.db.scheduledAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(failed.doneAt).toBeNull();
    expect(failed.runAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    finishHang();
    await vi.waitFor(async () => expect((await database.db.scheduledAction.findUniqueOrThrow({ where: { id: action.id } })).doneAt).not.toBeNull());
  });

  it('caps retry delay at one hour', () => {
    expect(retryDelayMs(1)).toBe(10_000);
    expect(retryDelayMs(3)).toBe(40_000);
    expect(retryDelayMs(30)).toBe(60 * 60_000);
  });
});
