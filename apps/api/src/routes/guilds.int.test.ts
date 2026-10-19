import { subscribeConfigInvalidation } from '@bot/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_USER } from '../testing/fake-oauth.js';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, ROLE_ID, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const MANAGE_GUILD = (1n << 5n).toString();
const NO_BOT_GUILD = '300000000000000013';
const MEMBER_GUILD = '300000000000000023';

describe('guild routes', () => {
  let t: TestApp;
  let cookie: string;
  const get = (url: string) => t.app.inject({ url, headers: { cookie } });

  beforeAll(async () => {
    t = await createTestApp();
    t.oauth.guilds = [
      { id: MEMBER_GUILD, name: 'Just a member', icon: null, owner: false, permissions: '0' },
      { id: NO_BOT_GUILD, name: 'Bot missing', icon: null, owner: true, permissions: '0' },
      { id: GUILD_ID, name: 'Managed', icon: null, owner: false, permissions: MANAGE_GUILD },
    ];
    await seedGuildSnapshot(t);
    await seedGuildSnapshot(t, MEMBER_GUILD);
    cookie = await login(t);
  });

  beforeEach(async () => {
    await t.redis.del(`user:${TEST_USER.id}:guilds`);
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists user guilds with management flags, manageable first', async () => {
    const response = await get('/v1/me/guilds');

    expect(response.json()).toEqual([
      { id: NO_BOT_GUILD, name: 'Bot missing', icon: null, owner: true, canManage: true, botPresent: false },
      { id: GUILD_ID, name: 'Managed', icon: null, owner: false, canManage: true, botPresent: true },
      { id: MEMBER_GUILD, name: 'Just a member', icon: null, owner: false, canManage: false, botPresent: true },
    ]);
  });

  it('caches the Discord guild list', async () => {
    const before = t.oauth.guildRequests;
    await get('/v1/me/guilds');
    await get('/v1/me/guilds');

    expect(t.oauth.guildRequests - before).toBe(1);
  });

  it('asks Discord once for requests at the same time', async () => {
    const before = t.oauth.guildRequests;
    const responses = await Promise.all(
      ['/v1/me/guilds', `/v1/guilds/${GUILD_ID}`, `/v1/guilds/${GUILD_ID}/channels`, `/v1/guilds/${GUILD_ID}/roles`].map(get),
    );

    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    expect(t.oauth.guildRequests - before).toBe(1);
  });

  it('refreshes an expiring token once for requests at the same time', async () => {
    t.oauth.tokenLifetimeMs = 0;
    const expiringCookie = await login(t);
    t.oauth.tokenLifetimeMs = 60 * 60_000;
    const before = t.oauth.refreshed;

    const responses = await Promise.all(
      [`/v1/guilds/${GUILD_ID}`, `/v1/guilds/${GUILD_ID}/channels`].map((url) => t.app.inject({ url, headers: { cookie: expiringCookie } })),
    );

    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(t.oauth.refreshed - before).toBe(1);
  });

  it('serves the last guild list while Discord rate-limits', async () => {
    await get('/v1/me/guilds');
    await t.redis.del(`user:${TEST_USER.id}:guilds`);
    t.oauth.guildsRateLimited = true;
    try {
      expect((await get(`/v1/guilds/${GUILD_ID}`)).statusCode).toBe(200);
    } finally {
      t.oauth.guildsRateLimited = false;
    }
  });

  it('reports a rate limit of Discord without a list to fall back on', async () => {
    await t.redis.del(`user:${TEST_USER.id}:guilds:last`);
    t.oauth.guildsRateLimited = true;
    try {
      expect((await get('/v1/me/guilds')).json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    } finally {
      t.oauth.guildsRateLimited = false;
    }
  });

  it('refreshes an expiring Discord token', async () => {
    t.oauth.tokenLifetimeMs = 0;
    const expiringCookie = await login(t);
    t.oauth.tokenLifetimeMs = 60 * 60_000;
    const before = t.oauth.refreshed;

    const response = await t.app.inject({ url: '/v1/me/guilds', headers: { cookie: expiringCookie } });

    expect(response.statusCode).toBe(200);
    expect(t.oauth.refreshed - before).toBe(1);
  });

  it('checks guild access', async () => {
    expect((await t.app.inject(`/v1/guilds/${GUILD_ID}`)).statusCode).toBe(401);
    expect((await get(`/v1/guilds/${MEMBER_GUILD}`)).json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect((await get(`/v1/guilds/${NO_BOT_GUILD}`)).json()).toMatchObject({ error: { code: 'BOT_NOT_IN_GUILD' } });
    expect((await get('/v1/guilds/not-a-snowflake')).statusCode).toBe(400);
  });

  it('returns the guild overview and snapshots', async () => {
    expect((await get(`/v1/guilds/${GUILD_ID}`)).json()).toEqual({
      meta: expect.objectContaining({ id: GUILD_ID, name: 'Test guild' }),
      settings: { locale: 'ru', timezone: 'Europe/Moscow', modRoleIds: [] },
    });
    expect((await get(`/v1/guilds/${GUILD_ID}/channels`)).json()).toEqual([expect.objectContaining({ id: CHANNEL_ID })]);
    expect((await get(`/v1/guilds/${GUILD_ID}/roles`)).json()).toHaveLength(2);
    expect((await get(`/v1/guilds/${GUILD_ID}/emojis`)).json()).toEqual([]);
  });

  it('updates settings, records the change and invalidates the guild everywhere', async () => {
    const invalidated = vi.fn();
    const unsubscribe = await subscribeConfigInvalidation(t.redis, t.deps.logger, invalidated);
    expect(await t.deps.guildLocales.get(GUILD_ID)).toBe('ru');

    const response = await t.app.inject({
      method: 'PATCH',
      url: `/v1/guilds/${GUILD_ID}`,
      headers: { cookie },
      payload: { locale: 'en', modRoleIds: [ROLE_ID] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ locale: 'en', timezone: 'Europe/Moscow', modRoleIds: [ROLE_ID] });
    expect((await get(`/v1/guilds/${GUILD_ID}`)).json()).toMatchObject({ settings: { locale: 'en' } });
    expect(await t.deps.guildLocales.get(GUILD_ID)).toBe('en');
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalledWith({ guildId: GUILD_ID }));
    await unsubscribe();

    const audit = (await get(`/v1/guilds/${GUILD_ID}/audit`)).json();
    expect(audit.items[0]).toMatchObject({ action: 'guild.update', userId: TEST_USER.id });
  });

  it('validates settings', async () => {
    const patch = (payload: object) =>
      t.app.inject({ method: 'PATCH', url: `/v1/guilds/${GUILD_ID}`, headers: { cookie }, payload });

    const unknownRole = await patch({ modRoleIds: ['499999999999999999'] });
    expect(unknownRole.statusCode).toBe(400);
    expect(unknownRole.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', details: [{ path: ['modRoleIds', 0] }] } });

    expect((await patch({ timezone: 'Mars/Olympus' })).statusCode).toBe(400);
    expect((await patch({ locale: 'de' })).statusCode).toBe(400);
  });

  it('paginates the audit log', async () => {
    for (const locale of ['ru', 'en', 'ru']) {
      await t.app.inject({ method: 'PATCH', url: `/v1/guilds/${GUILD_ID}`, headers: { cookie }, payload: { locale } });
    }

    const first = (await get(`/v1/guilds/${GUILD_ID}/audit?limit=2`)).json();
    const second = (await get(`/v1/guilds/${GUILD_ID}/audit?limit=2&cursor=${first.nextCursor}`)).json();

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1].id);
    expect(second.items[0].id).not.toBe(first.items[1].id);
  });
});
