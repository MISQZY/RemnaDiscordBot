import { defineModule, RedisKeys } from '@bot/core';
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

  it('keeps the complete guild list private to authenticated dashboard clients', async () => {
    const url = '/v1/vip/guilds';
    expect((await t.app.inject(url)).statusCode).toBe(401);
    expect((await t.app.inject({ url, headers: { cookie } })).statusCode).toBe(401);
    expect((await t.app.inject({ url, headers: { authorization: basic('wrong') } })).statusCode).toBe(401);
    expect((await t.app.inject({ url: `${url}/${GUILD_ID}`, headers: { cookie } })).statusCode).toBe(401);
  });

  it('lists connected guilds even without VIP, and verifies a binding target', async () => {
    await t.deps.db.guild.upsert({ where: { id: GUILD_ID }, create: { id: GUILD_ID }, update: { leftAt: null } });
    const gone = '400000000000000004';
    const missing = '500000000000000005';
    await t.deps.db.guild.createMany({ data: [{ id: gone, leftAt: new Date() }, { id: missing }] });
    await seedGuildSnapshot(t, gone);
    const headers = { authorization: basic() };
    const list = await t.app.inject({ url: '/v1/vip/guilds', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([{ id: GUILD_ID, name: 'Test guild', icon: null, memberCount: 10 }]);
    const detail = await t.app.inject({ url: `/v1/vip/guilds/${GUILD_ID}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(list.json()[0]);
    expect((await t.app.inject({ url: `/v1/vip/guilds/${gone}`, headers })).statusCode).toBe(403);
    expect((await t.app.inject({ url: `/v1/vip/guilds/${missing}`, headers })).statusCode).toBe(403);
    await t.redis.del(RedisKeys.guildMeta(gone));
    await t.deps.db.guild.deleteMany({ where: { id: { in: [gone, missing] } } });
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
