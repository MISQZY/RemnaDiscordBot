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
      { id: NO_BOT_GUILD, name: 'Bot missing', icon: null, owner: true, canManage: true, isModerator: true, botPresent: false },
      { id: GUILD_ID, name: 'Managed', icon: null, owner: false, canManage: true, isModerator: true, botPresent: true },
      { id: MEMBER_GUILD, name: 'Just a member', icon: null, owner: false, canManage: false, isModerator: false, botPresent: true },
    ]);
  });

  it('caches the Discord guild list', async () => {
    const before = t.oauth.guildRequests;
    await get('/v1/me/guilds');
    await get('/v1/me/guilds');

    expect(t.oauth.guildRequests - before).toBe(1);
  });

  it('manually refreshes guilds and permissions despite a fresh cached list', async () => {
    await get('/v1/me/guilds');
    const before = t.oauth.guildRequests;
    const original = t.oauth.guilds;
    t.oauth.guilds = original.map((guild) => guild.id === GUILD_ID ? { ...guild, name: 'Renamed', permissions: '0' } : guild);
    try {
      expect((await get('/v1/me/guilds')).json().find((g: { id: string }) => g.id === GUILD_ID)).toMatchObject({ name: 'Managed', canManage: true });
      const refreshed = await get('/v1/me/guilds?refresh=1');
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().find((g: { id: string }) => g.id === GUILD_ID)).toMatchObject({ name: 'Renamed', canManage: false });
      expect(t.oauth.guildRequests - before).toBe(1);
      expect((await get('/v1/me/guilds')).json().find((g: { id: string }) => g.id === GUILD_ID)).toMatchObject({ name: 'Renamed', canManage: false });
    } finally {
      t.oauth.guilds = original;
    }
  });

  it('shares simultaneous forced refreshes', async () => {
    await get('/v1/me/guilds');
    const before = t.oauth.guildRequests;
    const responses = await Promise.all([get('/v1/me/guilds?refresh=1'), get('/v1/me/guilds?refresh=1')]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(t.oauth.guildRequests - before).toBe(1);
  });

  it('reports a failed manual refresh and preserves the last cached list for normal reads', async () => {
    const cached = (await get('/v1/me/guilds')).json();
    t.oauth.guildsRateLimited = true;
    try {
      const refreshed = await get('/v1/me/guilds?refresh=1');
      expect(refreshed.statusCode).toBe(429);
      expect(refreshed.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
      expect((await get('/v1/me/guilds')).json()).toEqual(cached);
    } finally {
      t.oauth.guildsRateLimited = false;
    }
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

  it('allows read-only guild access for moderator role holders, denying write actions', async () => {
    const MOD_ROLE = '400000000000000044';
    await t.database.db.guild.upsert({
      where: { id: MEMBER_GUILD },
      create: { id: MEMBER_GUILD, modRoleIds: [MOD_ROLE] },
      update: { modRoleIds: [MOD_ROLE] },
    });
    t.rest.responses.set(`/guilds/${MEMBER_GUILD}/members/${TEST_USER.id}`, { roles: [MOD_ROLE] });
    t.rest.responses.set(`/guilds/${MEMBER_GUILD}`, { id: MEMBER_GUILD, name: 'Just a member' });
    await t.redis.del(`user:${TEST_USER.id}:guilds`);

    const listRes = await get('/v1/me/guilds');
    expect(listRes.json().find((g: { id: string }) => g.id === MEMBER_GUILD)).toMatchObject({
      id: MEMBER_GUILD,
      canManage: false,
      isModerator: true,
    });

    const overviewRes = await get(`/v1/guilds/${MEMBER_GUILD}`);
    expect(overviewRes.statusCode).toBe(200);

    const modulesRes = await get(`/v1/guilds/${MEMBER_GUILD}/modules`);
    expect(modulesRes.statusCode).toBe(200);

    const patchRes = await t.app.inject({
      method: 'PATCH',
      url: `/v1/guilds/${MEMBER_GUILD}`,
      headers: { cookie },
      payload: { locale: 'en' },
    });
    expect(patchRes.statusCode).toBe(403);
    expect(patchRes.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('returns the guild overview and snapshots', async () => {
    const res = await get(`/v1/guilds/${GUILD_ID}`);
    expect(res.headers.etag).toBe('"default"');
    expect(res.json()).toEqual({
      meta: expect.objectContaining({ id: GUILD_ID, name: 'Test guild' }),
      settings: { locale: 'ru', timezone: 'Europe/Moscow', modRoleIds: [], updatedAt: null },
      vip: null,
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
    expect(response.headers.etag).toBeDefined();
    expect(response.json()).toEqual({
      locale: 'en',
      timezone: 'Europe/Moscow',
      modRoleIds: [ROLE_ID],
      updatedAt: expect.any(String),
    });
    expect((await get(`/v1/guilds/${GUILD_ID}`)).json()).toMatchObject({ settings: { locale: 'en' } });
    expect(await t.deps.guildLocales.get(GUILD_ID)).toBe('en');
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalledWith({ guildId: GUILD_ID }));
    await unsubscribe();

    const audit = (await get(`/v1/guilds/${GUILD_ID}/audit`)).json();
    expect(audit.items[0]).toMatchObject({ action: 'guild.update', userId: TEST_USER.id });
  });

  it('enforces optimistic locking via If-Match / ETag', async () => {
    const overview = await get(`/v1/guilds/${GUILD_ID}`);
    const etag = overview.headers.etag as string;
    expect(etag).toBeDefined();

    // Outdated ETag returns 412
    const conflict = await t.app.inject({
      method: 'PATCH',
      url: `/v1/guilds/${GUILD_ID}`,
      headers: { cookie, 'if-match': '"2020-01-01T00:00:00.000Z"' },
      payload: { locale: 'ru' },
    });
    expect(conflict.statusCode).toBe(412);
    expect(conflict.json()).toMatchObject({ error: { code: 'PRECONDITION_FAILED' } });

    // Matching ETag succeeds
    const success = await t.app.inject({
      method: 'PATCH',
      url: `/v1/guilds/${GUILD_ID}`,
      headers: { cookie, 'if-match': etag },
      payload: { locale: 'ru' },
    });
    expect(success.statusCode).toBe(200);
    expect(success.headers.etag).not.toBe(etag);
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
