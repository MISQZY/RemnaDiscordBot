import { createTestDatabase, type TestDatabase } from '@bot/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pruneFinishedJobs, purgeLeftGuilds } from './maintenance.js';

const LEFT = '100000000000000001';
const RECENT = '100000000000000002';
const ACTIVE = '100000000000000003';
const DAY = 86_400_000;

describe('maintenance', () => {
  let database: TestDatabase;
  const now = new Date('2026-10-20T00:00:00Z');

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    await db.guild.createMany({
      data: [
        { id: LEFT, leftAt: new Date(now.getTime() - 40 * DAY) },
        { id: RECENT, leftAt: new Date(now.getTime() - 5 * DAY) },
        { id: ACTIVE },
      ],
    });
    for (const guildId of [LEFT, RECENT, ACTIVE]) {
      await db.guildModuleConfig.create({ data: { guildId, moduleId: 'leveling', enabled: true, config: {}, version: 1 } });
      await db.memberLevel.create({ data: { guildId, userId: '9', xp: 10 } });
      await db.modCase.create({ data: { guildId, number: 1, type: 'warn', targetId: '9', moderatorId: '8' } });
    }
    const source = await db.notificationSource.create({ data: { provider: 'youtube', externalId: 'UC1', name: 'Chan' } });
    await db.notificationSubscription.create({ data: { guildId: LEFT, sourceId: source.id, channelId: '1', message: {} } });
    await db.scheduledAction.createMany({
      data: [
        { guildId: ACTIVE, type: 'moderation:unban', payload: {}, runAt: now, doneAt: new Date(now.getTime() - 10 * DAY) },
        { guildId: ACTIVE, type: 'moderation:unban', payload: {}, runAt: now, doneAt: new Date(now.getTime() - DAY) },
        { guildId: ACTIVE, type: 'moderation:unban', payload: {}, runAt: now },
      ],
    });
  });

  afterAll(async () => {
    await database.cleanup();
  });

  it('deletes the data of guilds left longer ago than the retention period', async () => {
    const { db } = database;
    expect(await purgeLeftGuilds(db, 30, now)).toEqual([LEFT]);

    expect((await db.guild.findMany({ orderBy: { id: 'asc' } })).map((g) => g.id)).toEqual([RECENT, ACTIVE]);
    expect(await db.guildModuleConfig.count({ where: { guildId: LEFT } })).toBe(0);
    expect(await db.memberLevel.count({ where: { guildId: LEFT } })).toBe(0);
    expect(await db.modCase.count()).toBe(2);
    // The source lost its only subscriber and is no longer polled.
    expect(await db.notificationSource.count()).toBe(0);
  });

  it('drops finished jobs after the history period', async () => {
    expect(await pruneFinishedJobs(database.db, 7, now)).toBe(1);
    expect(await database.db.scheduledAction.count()).toBe(2);
  });
});
