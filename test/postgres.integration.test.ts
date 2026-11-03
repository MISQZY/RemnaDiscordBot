import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '../packages/db/src/index.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../packages/core/src/jobs/scheduler.js';
import { IntervalRunner, JobRunner } from '../packages/core/src/jobs/runner.js';
import { ModuleRegistry } from '../packages/core/src/registry.js';
import { createTestModule, testLogger } from '../packages/core/src/testing/fixtures.js';
import { PrismaVipStore } from '../packages/core/src/vip/store.js';
import { GiveawayService } from '../packages/modules/giveaways/src/service.js';
import { defaultGiveawaysConfig } from '../packages/modules/giveaways/src/config.js';
import type { CoreServices } from '../packages/core/src/context.js';

const schema = `test_${randomUUID().replaceAll('-', '')}`;
let db: PrismaClient;
let admin: PrismaClient;
let scheduler: Scheduler;

beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL must name a disposable local PostgreSQL database');
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('PostgreSQL tests require a local database');
  admin = new PrismaClient({ datasourceUrl: url.toString() });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema);
  const cli = createRequire(new URL('../packages/db/package.json', import.meta.url)).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [cli, 'migrate', 'deploy'], { cwd: new URL('../packages/db', import.meta.url), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
  execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-url', url.toString(), '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], { cwd: new URL('../packages/db', import.meta.url), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
  db = new PrismaClient({ datasourceUrl: url.toString() });
  scheduler = new Scheduler(db);
});

afterAll(async () => {
  await db?.$disconnect();
  if (admin) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});

const schedule = () => scheduler.schedule({ guildId: '111111111111111111', moduleId: 'test', job: 'run', payload: {}, runAt: new Date(0) });
const claimOptions = { limit: 1, lockMs: 60_000, maxAttempts: 5 };

describe('PostgreSQL job leases', () => {
  it('fences a late acknowledgement after another worker acquired the expired lease', async () => {
    const row = await schedule();
    const [first] = await scheduler.claimDue(claimOptions);
    expect(first?.id).toBe(row.id);
    await db.scheduledAction.update({ where: { id: row.id }, data: { lockedUntil: new Date(0) } });
    const [second] = await scheduler.claimDue(claimOptions);
    expect(second?.lockToken).not.toBe(first!.lockToken);
    await scheduler.complete(row.id, first!.lockToken!);
    await scheduler.fail(row.id, 'late error', new Date(0), first!.lockToken!);
    expect(await db.scheduledAction.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ doneAt: null, lockToken: second!.lockToken, attempts: 2 });
    await scheduler.complete(row.id, second!.lockToken!);
  });

  it('does not let concurrent workers acquire the same row', async () => {
    const row = await schedule();
    const claims = await Promise.all([scheduler.claimDue(claimOptions), scheduler.claimDue(claimOptions)]);
    expect(claims.flat().filter((action) => action.id === row.id)).toHaveLength(1);
    await scheduler.cancelById(row.id);
  });

  it('recovers the last attempt of a worker that crashed before recording its error', async () => {
    const row = await schedule();
    await db.scheduledAction.update({ where: { id: row.id }, data: { attempts: 5, lockedUntil: new Date(0) } });
    await scheduler.claimDue(claimOptions);
    expect((await scheduler.findFailed()).items.some((action) => action.id === row.id)).toBe(true);
  });

  it('allows a handler to cancel its own action without an acknowledgement error', async () => {
    const key = `self:${randomUUID()}`;
    const errors = vi.fn();
    const module = createTestModule('test', {
      jobs: { run: { whenDisabled: 'run', run: async () => { await scheduler.cancel(key); } } },
    });
    const services = { db, scheduler, logger: { ...testLogger, child: () => testLogger, error: errors } } as unknown as CoreServices;
    const runner = new JobRunner(services, new ModuleRegistry([module]));
    const row = await scheduler.schedule({ guildId: '111111111111111111', moduleId: 'test', job: 'run', key, payload: {}, runAt: new Date(0) });
    await runner.tick();
    expect(errors).not.toHaveBeenCalled();
    expect((await db.scheduledAction.findUniqueOrThrow({ where: { id: row.id } })).doneAt).not.toBeNull();
  });
});

describe('PostgreSQL persistent giveaway results', () => {
  it('keeps a draw and its delivery when Discord fails, and retries without changing winners', async () => {
    const post = vi.fn().mockRejectedValueOnce(new Error('Discord temporarily down')).mockResolvedValue({ id: '777777777777777777' });
    const services = { db, scheduler, logger: testLogger,
      rest: { get: async () => ({ roles: [], joined_at: '2020-01-01T00:00:00Z' }), post },
      guildLocales: { get: async () => 'en' }, i18n: { t: (_locale: string, key: string) => key },
    } as unknown as CoreServices;
    const service = new GiveawayService(services);
    const row = await db.giveaway.create({ data: { guildId: '111111111111111111', channelId: '222222222222222222', prize: 'test', winners: 1, endsAt: new Date(), hostId: '333333333333333333' } });
    await db.giveawayEntry.create({ data: { giveawayId: row.id, userId: '444444444444444444' } });
    const ended = await service.end(row, { ...defaultGiveawaysConfig, dmWinners: false });
    expect(ended.winnerIds).toEqual(['444444444444444444']);
    const delivery = await db.giveawayDelivery.findFirstOrThrow({ where: { giveawayId: row.id } });
    expect(delivery.deliveredAt).toBeNull();
    expect(await db.scheduledAction.count({ where: { key: `giveaway:announce:${delivery.id}`, doneAt: null } })).toBe(1);
    await service.announce(delivery.id, { ...defaultGiveawaysConfig, dmWinners: false });
    await service.announce(delivery.id, { ...defaultGiveawaysConfig, dmWinners: false });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1].body.nonce).toBe(post.mock.calls[1]![1].body.nonce);
    expect((await db.giveaway.findUniqueOrThrow({ where: { id: row.id } })).winnerIds).toEqual(ended.winnerIds);
  });

  it('serializes entry toggles without aborting on unique violations', async () => {
    const row = await db.giveaway.create({ data: { guildId: '111111111111111111', channelId: '222222222222222222', prize: 'entry race', winners: 1, endsAt: new Date(), hostId: '333333333333333333' } });
    const service = new GiveawayService({ db, guildLocales: { get: async () => 'en' }, i18n: { t: (_locale: string, key: string) => key } } as unknown as CoreServices);
    await Promise.all([service.toggleEntry(row, '444444444444444444'), service.toggleEntry(row, '444444444444444444')]);
    expect(await db.giveawayEntry.count({ where: { giveawayId: row.id } })).toBe(0);
    expect((await db.giveaway.findUniqueOrThrow({ where: { id: row.id } })).entries).toBe(0);
  });
});

it('rejects a VIP snapshot delivered after a newer revision', async () => {
  const store = new PrismaVipStore(db);
  const state = { modules: [], features: [], guilds: [{ guildId: '111111111111111111', expiresAt: null }] };
  expect(await store.replace({ ...state, revision: 2 })).toBe(true);
  expect(await store.replace({ ...state, revision: 1, guilds: [] })).toBe(false);
  expect(await store.replace({ ...state, guilds: [] })).toBe(false);
  expect((await store.load()).guilds).toHaveLength(1);
});

it.skipIf(!process.env.TEST_REDIS_URL)('keeps interval tasks exclusive on real Redis after their period expires', async () => {
  const url = new URL(process.env.TEST_REDIS_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Redis tests require a local server');
  const Redis = createRequire(new URL('../packages/core/package.json', import.meta.url))('ioredis') as new (url: string) => CoreServices['redis'];
  const redis = new Redis(url.toString());
  let finish: () => void = () => {};
  const task = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const id = `interval-${randomUUID().slice(0, 12)}`;
  const module = createTestModule(id, { intervals: { task: { everyMs: 20, run: task } } });
  const services = { redis, logger: testLogger } as CoreServices;
  const registry = new ModuleRegistry([module]);
  const first = new IntervalRunner(services, registry);
  const second = new IntervalRunner(services, registry);
  try {
    const pending = first.runOnce(id, 'task');
    await vi.waitFor(() => expect(task).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await second.runOnce(id, 'task')).toBe(false);
    finish();
    await pending;
    const next = second.runOnce(id, 'task');
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    finish();
    await next;
  } finally {
    finish();
    await redis.quit();
  }
});
