import { defineModule } from '@bot/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, GUILD_ID, login, seedGuildSnapshot, TEST_CLIENT, type TestApp } from '../testing/app.js';

const music = defineModule({ id: 'music', configSchema: z.object({}), defaultConfig: {}, configVersion: 1 });
const general = defineModule({ id: 'general', configSchema: z.object({}), defaultConfig: {}, configVersion: 1, alwaysEnabled: true });

const basic = (secret = TEST_CLIENT.secret) => `Basic ${Buffer.from(`${TEST_CLIENT.id}:${secret}`).toString('base64')}`;

describe('VIP routes', () => {
  let t: TestApp;
  let cookie: string;
  const putVip = (payload: object, authorization = basic()) =>
    t.app.inject({ method: 'PUT', url: '/v1/vip', headers: { authorization }, payload });
  const enableMusic = () =>
    t.app.inject({ method: 'PATCH', url: `/v1/guilds/${GUILD_ID}/modules/music`, headers: { cookie }, payload: { enabled: true } });

  beforeAll(async () => {
    t = await createTestApp({ modules: [music, general] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    await seedGuildSnapshot(t);
    cookie = await login(t);
  });

  afterAll(async () => {
    await t.close();
  });

  it('takes the state only from a known client', async () => {
    expect((await putVip({ modules: [], guilds: [] }, basic('x'.repeat(40)))).statusCode).toBe(401);
    expect((await putVip({ modules: [], guilds: [] })).statusCode).toBe(204);
  });

  it('locks VIP modules until the guild has VIP', async () => {
    await putVip({ modules: ['music', 'general', 'gone'], guilds: [] });

    const catalog = (await t.app.inject('/v1/modules')).json() as { id: string; vip: boolean }[];
    expect(catalog.map((m) => [m.id, m.vip])).toEqual([['music', true], ['general', false]]);

    const refused = await enableMusic();
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { code: 'VIP_REQUIRED' } });

    await putVip({ modules: ['music'], guilds: [{ guildId: GUILD_ID, expiresAt: null }] });
    expect((await enableMusic()).json()).toMatchObject({ enabled: true });

    const overview = (await t.app.inject({ url: `/v1/guilds/${GUILD_ID}`, headers: { cookie } })).json();
    expect(overview.vip).toEqual({ expiresAt: null });
    expect(await t.deps.db.guildVip.count()).toBe(1);
  });

  it('keeps VIP features, none when a dashboard sends none', async () => {
    await putVip({ modules: [], features: ['profile'], guilds: [] });
    expect((await t.deps.db.vipSettings.findFirst())?.features).toEqual(['profile']);
    expect(t.deps.config.vip.featureLocked(GUILD_ID, 'profile')).toBe(true);
    expect((await putVip({ modules: [], features: ['unknown'], guilds: [] })).statusCode).toBe(400);

    await putVip({ modules: [], guilds: [] });
    expect((await t.deps.db.vipSettings.findFirst())?.features).toEqual([]);
  });
});
