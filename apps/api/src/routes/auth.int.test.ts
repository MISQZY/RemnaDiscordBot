import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_USER } from '../testing/fake-oauth.js';
import { createTestApp, login, type TestApp } from '../testing/app.js';

describe('auth routes', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('redirects to Discord with a one-time state', async () => {
    const response = await t.app.inject('/v1/auth/login?redirect=/guilds');
    const location = new URL(response.headers.location!);

    expect(response.statusCode).toBe(302);
    expect(location.origin).toBe('https://discord.test');
    expect(location.searchParams.get('redirect_uri')).toBe('http://api.test/v1/auth/callback');
    expect(await t.redis.get(`oauth:state:${location.searchParams.get('state')}`)).toBe('/guilds');
  });

  it('signs in, sets a session cookie and redirects to the web', async () => {
    const start = await t.app.inject('/v1/auth/login?redirect=/guilds');
    const state = new URL(start.headers.location!).searchParams.get('state');

    const callback = await t.app.inject(`/v1/auth/callback?code=valid-code&state=${state}`);

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://web.test/guilds');
    expect(callback.cookies.find((c) => c.name === 'sid')).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    expect(await t.database.db.dashboardUser.findUnique({ where: { id: TEST_USER.id } })).toMatchObject({
      username: 'tester',
    });
  });

  it('rejects reused and unknown states', async () => {
    const start = await t.app.inject('/v1/auth/login');
    const state = new URL(start.headers.location!).searchParams.get('state');
    await t.app.inject(`/v1/auth/callback?code=valid-code&state=${state}`);

    const reused = await t.app.inject(`/v1/auth/callback?code=valid-code&state=${state}`);
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('ignores redirects to other origins', async () => {
    const start = await t.app.inject('/v1/auth/login?redirect=//evil.example');
    const state = new URL(start.headers.location!).searchParams.get('state');

    expect(await t.redis.get(`oauth:state:${state}`)).toBe('/');
  });

  it('returns the current user for a valid session', async () => {
    const cookie = await login(t);
    const response = await t.app.inject({ url: '/v1/me', headers: { cookie } });

    expect(response.json()).toEqual({ id: TEST_USER.id, username: 'tester', globalName: 'Tester', avatar: null });
  });

  it('requires a session', async () => {
    const anonymous = await t.app.inject('/v1/me');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });

    const forged = await t.app.inject({ url: '/v1/me', headers: { cookie: 'sid=forged-session-id' } });
    expect(forged.statusCode).toBe(401);
  });

  it('logs out and revokes the Discord token', async () => {
    const cookie = await login(t);

    const logout = await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } });

    expect(logout.statusCode).toBe(204);
    expect(t.oauth.revoked).toContain('access-1');
    expect((await t.app.inject({ url: '/v1/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('builds the bot invite link', async () => {
    const response = await t.app.inject('/v1/auth/invite?guildId=300000000000000003');
    const url = new URL(response.json<{ url: string }>().url);

    expect(url.searchParams.get('client_id')).toBe('200000000000000002');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(url.searchParams.get('guild_id')).toBe('300000000000000003');
  });
});
