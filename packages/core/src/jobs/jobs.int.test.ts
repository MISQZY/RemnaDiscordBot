import { I18n } from '@bot/i18n';
import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import { REST } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EventBus } from '../bus.js';
import { ConfigService } from '../config/service.js';
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

  const module = defineModule({
    id: 'moderation',
    configSchema: z.object({}),
    defaultConfig: {},
    configVersion: 1,
    jobs: {
      unban: async (payload, ctx) => void handled.push({ payload, guildId: ctx.guildId, moduleId: ctx.moduleId }),
      broken: failing,
    },
    intervals: { flush: { everyMs: 60_000, run: flush } },
  });
  const registry = new ModuleRegistry([module]);

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

  it('replaces and cancels jobs by key', async () => {
    const schedule = (userId: string) =>
      services.scheduler.schedule({ guildId: GUILD, moduleId: 'moderation', job: 'unban', payload: { userId }, runAt: past(), key: 'unban:5' });
    await schedule('first');
    await schedule('second');

    expect(await database.db.scheduledAction.count()).toBe(1);
    expect(await services.scheduler.cancel('unban:5')).toBe(true);
    expect(await services.scheduler.cancel('unban:5')).toBe(false);
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

  it('caps retry delay at one hour', () => {
    expect(retryDelayMs(1)).toBe(10_000);
    expect(retryDelayMs(3)).toBe(40_000);
    expect(retryDelayMs(30)).toBe(60 * 60_000);
  });
});
