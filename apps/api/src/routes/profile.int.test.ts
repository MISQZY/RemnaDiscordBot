import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, GUILD_ID, login, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const BOT = '500000000000000005';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('bot profile', () => {
  let t: TestApp;
  let cookie: string;
  const url = `/v1/guilds/${GUILD_ID}/profile`;
  const patch = (payload: object) => t.app.inject({ method: 'PATCH', url, headers: { cookie }, payload });

  beforeAll(async () => {
    t = await createTestApp();
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    t.rest.responses.set('/users/@me', { id: BOT, username: 'bot', global_name: 'Bot', avatar: 'abc' });
    t.rest.responses.set(`/guilds/${GUILD_ID}/members/${BOT}`, { nick: 'Helper', avatar: 'a_def', banner: null, roles: [] });
    await seedGuildSnapshot(t);
    cookie = await login(t);
  });

  beforeEach(async () => {
    t.rest.calls.length = 0;
    await t.deps.redis.del(`profile:pictures:${GUILD_ID}`);
  });

  afterAll(async () => {
    await t.close();
  });

  it('reads the profile on the server with the global one to fall back to', async () => {
    const profile = (await t.app.inject({ method: 'GET', url, headers: { cookie } })).json();
    expect(profile).toEqual({
      nick: 'Helper',
      avatarUrl: `https://cdn.discordapp.com/guilds/${GUILD_ID}/users/${BOT}/avatars/a_def.gif?size=256`,
      bannerUrl: null,
      bio: null,
      global: { name: 'Bot', avatarUrl: `https://cdn.discordapp.com/avatars/${BOT}/abc.png?size=256` },
      editable: true,
      vipRequired: false,
    });
  });

  it('changes the name, avatar and About me, keeps the About me and records history', async () => {
    const res = await patch({ nick: 'Support', avatar: PNG, bio: 'Ask me' });
    expect(res.statusCode).toBe(200);
    expect(res.json().bio).toBe('Ask me');
    expect(t.rest.calls.find((c) => c.method === 'patch')).toMatchObject({
      route: `/guilds/${GUILD_ID}/members/@me`,
      body: { nick: 'Support', avatar: PNG, bio: 'Ask me' },
    });
    expect(await t.database.db.dashboardAuditLog.count({ where: { action: 'guild.profile' } })).toBe(1);
  });

  it('refuses what is not a picture and limits picture changes', async () => {
    expect((await patch({ avatar: 'data:text/html;base64,PGI+' })).statusCode).toBe(400);
    expect((await patch({ avatar: PNG })).statusCode).toBe(200);
    expect((await patch({ banner: PNG })).statusCode).toBe(200);
    expect((await patch({ avatar: null })).statusCode).toBe(429);
    // The name is not a picture: it still changes.
    expect((await patch({ nick: null })).statusCode).toBe(200);
  });

  it('needs VIP for changes once the profile is a VIP feature', async () => {
    t.deps.config.vip.set({ modules: [], features: ['profile'], guilds: [] });
    expect((await t.app.inject({ method: 'GET', url, headers: { cookie } })).json()).toMatchObject({ vipRequired: true });
    const refused = await patch({ nick: 'Support' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { code: 'VIP_REQUIRED' } });

    t.deps.config.vip.set({ modules: [], features: ['profile'], guilds: [{ guildId: GUILD_ID, expiresAt: null }] });
    expect((await patch({ nick: 'Support' })).statusCode).toBe(200);
    t.deps.config.vip.set({ modules: [], guilds: [] });
  });
});
