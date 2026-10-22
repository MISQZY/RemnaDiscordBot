import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_USER } from '../testing/fake-oauth.js';
import { TEST_CLIENT, createTestApp, login, type TestApp } from '../testing/app.js';

/** The signed state cookie /v1/auth/login gave the browser, as a request header. */
const stateCookie = (start: { cookies: { name: string; value: string }[] }) =>
  start.cookies.filter((c) => c.name === 'oauth_state').map((c) => `${c.name}=${c.value}`).join('; ');

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
    expect(JSON.parse((await t.redis.get(`oauth:state:${location.searchParams.get('state')}`))!)).toEqual({ redirect: '/guilds' });
  });

  it('signs in, sets a session cookie and redirects to the web', async () => {
    const start = await t.app.inject('/v1/auth/login?redirect=/guilds');
    const state = new URL(start.headers.location!).searchParams.get('state');

    const callback = await t.app.inject({ url: `/v1/auth/callback?code=valid-code&state=${state}`, headers: { cookie: stateCookie(start) } });

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
    const headers = { cookie: stateCookie(start) };
    await t.app.inject({ url: `/v1/auth/callback?code=valid-code&state=${state}`, headers });

    const reused = await t.app.inject({ url: `/v1/auth/callback?code=valid-code&state=${state}`, headers });
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('signs in only the browser that started the login', async () => {
    const start = await t.app.inject('/v1/auth/login?redirect=/guilds');
    const state = new URL(start.headers.location!).searchParams.get('state');

    const elsewhere = await t.app.inject(`/v1/auth/callback?code=valid-code&state=${state}`);
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.cookies.find((c) => c.name === 'sid')).toBeUndefined();
  });

  it('ignores redirects to other origins', async () => {
    const start = await t.app.inject('/v1/auth/login?redirect=//evil.example');
    const state = new URL(start.headers.location!).searchParams.get('state');

    expect(JSON.parse((await t.redis.get(`oauth:state:${state}`))!)).toEqual({ redirect: '/' });
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

  describe('external client', () => {
    const basic = (secret = TEST_CLIENT.secret) => `Basic ${Buffer.from(`${TEST_CLIENT.id}:${secret}`).toString('base64')}`;

    /** Runs the login of the test client up to its callback and returns the callback URL. */
    async function clientLogin(query = 'code=valid-code'): Promise<URL> {
      const start = await t.app.inject(`/v1/auth/login?client=${TEST_CLIENT.id}&state=client-state`);
      const state = new URL(start.headers.location!).searchParams.get('state');
      const callback = await t.app.inject(`/v1/auth/callback?${query}&state=${state}`);
      expect(callback.statusCode).toBe(302);
      expect(callback.cookies.find((c) => c.name === 'sid')).toBeUndefined();
      return new URL(callback.headers.location!);
    }

    async function exchange(code: string, secret?: string) {
      return t.app.inject({ method: 'POST', url: '/v1/auth/token', headers: { authorization: basic(secret) }, payload: { code } });
    }

    it('refuses unknown clients and a missing state', async () => {
      expect((await t.app.inject('/v1/auth/login?client=unknown&state=x')).statusCode).toBe(400);
      expect((await t.app.inject(`/v1/auth/login?client=${TEST_CLIENT.id}`)).statusCode).toBe(400);
    });

    it('ends on the client callback with a code and the client state', async () => {
      const callback = await clientLogin();

      expect(callback.origin + callback.pathname).toBe(TEST_CLIENT.callbackUrl);
      expect(callback.searchParams.get('state')).toBe('client-state');
      expect(callback.searchParams.get('code')).toBeTruthy();
    });

    it('passes a declined login to the client', async () => {
      const callback = await clientLogin('error=access_denied');

      expect(callback.searchParams.get('error')).toBe('access_denied');
      expect(callback.searchParams.get('state')).toBe('client-state');
    });

    it('exchanges the code once for a bearer token', async () => {
      const code = (await clientLogin()).searchParams.get('code')!;

      const response = await exchange(code);
      expect(response.statusCode).toBe(200);
      const { token, user } = response.json<{ token: string; user: { id: string } }>();
      expect(user.id).toBe(TEST_USER.id);

      const me = await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
      expect(me.json()).toMatchObject({ id: TEST_USER.id });
      expect((await exchange(code)).statusCode).toBe(400);
    });

    it('refuses a wrong client secret', async () => {
      const code = (await clientLogin()).searchParams.get('code')!;

      expect((await exchange(code, 'wrong-secret')).statusCode).toBe(401);
    });

    it('keeps bearer and cookie sessions apart', async () => {
      const code = (await clientLogin()).searchParams.get('code')!;
      const { token } = (await exchange(code)).json<{ token: string }>();
      const cookie = await login(t);

      const asCookie = await t.app.inject({ url: '/v1/me', headers: { cookie: `sid=${t.app.signCookie(token)}` } });
      expect(asCookie.statusCode).toBe(401);
      const asBearer = await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${cookie.slice('sid='.length)}` } });
      expect(asBearer.statusCode).toBe(401);
    });

    it('logs out a bearer session', async () => {
      const code = (await clientLogin()).searchParams.get('code')!;
      const { token } = (await exchange(code)).json<{ token: string }>();
      const authorization = `Bearer ${token}`;

      expect((await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization } })).statusCode).toBe(204);
      expect((await t.app.inject({ url: '/v1/me', headers: { authorization } })).statusCode).toBe(401);
    });
  });

  it('builds the bot invite link', async () => {
    const response = await t.app.inject('/v1/auth/invite?guildId=300000000000000003');
    const url = new URL(response.json<{ url: string }>().url);

    expect(url.searchParams.get('client_id')).toBe('200000000000000002');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(url.searchParams.get('guild_id')).toBe('300000000000000003');
  });
});
