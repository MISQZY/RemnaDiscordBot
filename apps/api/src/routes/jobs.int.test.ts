import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, GUILD_ID, login, seedGuildSnapshot, TEST_CLIENT, type TestApp } from '../testing/app.js';

const basic = (secret = TEST_CLIENT.secret) => `Basic ${Buffer.from(`${TEST_CLIENT.id}:${secret}`).toString('base64')}`;

describe('jobs routes', () => {
  let t: TestApp;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestApp();
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    await seedGuildSnapshot(t);
    cookie = await login(t);
  });

  afterAll(async () => {
    await t.close();
  });

  it('rejects unauthenticated requests to /v1/jobs/failed', async () => {
    const res = await t.app.inject('/v1/jobs/failed');
    expect(res.statusCode).toBe(401);
  });

  it('rejects cookie user requesting global failed jobs list without guildId', async () => {
    const res = await t.app.inject({ url: '/v1/jobs/failed', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('allows client to list all failed jobs and user to list for their managed guild', async () => {
    // Seed a failed job
    const failedJob = await t.deps.db.scheduledAction.create({
      data: {
        guildId: GUILD_ID,
        type: 'giveaways:draw',
        payload: { giveawayId: 'gw-1' },
        runAt: new Date(),
        doneAt: new Date(),
        attempts: 5,
        lastError: 'Channel not found',
      },
    });

    // 1. Client reads globally
    const clientRes = await t.app.inject({
      url: '/v1/jobs/failed',
      headers: { authorization: basic() },
    });
    expect(clientRes.statusCode).toBe(200);
    const clientBody = clientRes.json();
    expect(clientBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: failedJob.id,
          guildId: GUILD_ID,
          guildName: 'Test guild',
          type: 'giveaways:draw',
          lastError: 'Channel not found',
          attempts: 5,
        }),
      ]),
    );

    // 2. User with canManage reads for GUILD_ID
    const userRes = await t.app.inject({
      url: `/v1/jobs/failed?guildId=${GUILD_ID}`,
      headers: { cookie },
    });
    expect(userRes.statusCode).toBe(200);
    expect(userRes.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: failedJob.id,
          guildId: GUILD_ID,
        }),
      ]),
    );

    // 3. User forbidden on unmanaged guild
    const forbiddenRes = await t.app.inject({
      url: '/v1/jobs/failed?guildId=999999999999999999',
      headers: { cookie },
    });
    expect(forbiddenRes.statusCode).toBe(403);
  });

  it('retries a failed job via POST /v1/jobs/:id/retry and deletes via DELETE /v1/jobs/:id', async () => {
    const job = await t.deps.db.scheduledAction.create({
      data: {
        guildId: GUILD_ID,
        type: 'moderation:unban',
        payload: { userId: 'u-1' },
        runAt: new Date(),
        doneAt: new Date(),
        attempts: 5,
        lastError: 'Discord API 500',
      },
    });

    // 1. Retry
    const retryRes = await t.app.inject({
      method: 'POST',
      url: `/v1/jobs/${job.id}/retry`,
      headers: { authorization: basic() },
    });
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json()).toMatchObject({
      id: job.id,
      attempts: 0,
      type: 'moderation:unban',
    });

    // The job is now pending (doneAt: null), so it no longer appears in failed jobs list
    const listAfterRetry = await t.app.inject({
      url: `/v1/jobs/failed?guildId=${GUILD_ID}`,
      headers: { authorization: basic() },
    });
    expect(listAfterRetry.json().items.some((item: { id: string }) => item.id === job.id)).toBe(false);

    // 2. Mark failed again and delete
    await t.deps.db.scheduledAction.update({
      where: { id: job.id },
      data: { doneAt: new Date(), lastError: 'Permanent failure' },
    });

    const deleteRes = await t.app.inject({
      method: 'DELETE',
      url: `/v1/jobs/${job.id}`,
      headers: { authorization: basic() },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({ ok: true });

    // Ensure row deleted from DB
    const inDb = await t.deps.db.scheduledAction.findUnique({ where: { id: job.id } });
    expect(inDb).toBeNull();

    // 3. Retry on missing returns 404
    const notFoundRetry = await t.app.inject({
      method: 'POST',
      url: `/v1/jobs/${job.id}/retry`,
      headers: { authorization: basic() },
    });
    expect(notFoundRetry.statusCode).toBe(404);
  });
});
