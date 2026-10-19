import { defineModule, EntityChecker, subscribeConfigInvalidation } from '@bot/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, ROLE_ID, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const LevelingConfig = z.object({
  xpPerMessage: z.number().int().min(1).default(10),
  announce: z.boolean().default(true),
});

const leveling = defineModule({
  id: 'leveling',
  configSchema: LevelingConfig,
  defaultConfig: { xpPerMessage: 10, announce: true },
  configVersion: 1,
  locales: { ru: { name: 'Уровни' }, en: { name: 'Leveling' } },
  api: (app, ctx) => {
    app.get('/stats', async (request) => {
      const { guildId } = request.params as { guildId: string };
      return { guildId, xpPerMessage: (await ctx.getConfig(guildId)).xpPerMessage };
    });
  },
});

const general = defineModule({
  id: 'general',
  configSchema: z.object({}),
  defaultConfig: {},
  configVersion: 1,
  alwaysEnabled: true,
});

const announcer = defineModule({
  id: 'announcer',
  configSchema: z.object({ channelId: z.string().nullable(), roleIds: z.array(z.string()) }),
  defaultConfig: { channelId: null, roleIds: [] },
  configVersion: 1,
  validateConfig: (cfg, guild) =>
    new EntityChecker(guild).textChannel(cfg.channelId, ['channelId']).roles(cfg.roleIds, ['roleIds'], { assignable: true }).issues,
});

describe('module routes', () => {
  let t: TestApp;
  let cookie: string;
  const url = (suffix = '') => `/v1/guilds/${GUILD_ID}/modules${suffix}`;
  const send = (method: 'PUT' | 'PATCH' | 'POST', path: string, payload?: object, headers: Record<string, string> = {}) =>
    t.app.inject({ method, url: path, headers: { cookie, ...headers }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestApp({ modules: [leveling, general, announcer] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    await seedGuildSnapshot(t);
    cookie = await login(t);
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists the module catalog with JSON Schemas and localized names', async () => {
    const response = await t.app.inject({ url: '/v1/modules', headers: { 'accept-language': 'en-US,en;q=0.9' } });
    const [info] = response.json();

    expect(info).toMatchObject({ id: 'leveling', name: 'Leveling', alwaysEnabled: false });
    expect(info.configSchema).toMatchObject({ type: 'object', properties: { xpPerMessage: { type: 'integer' } } });
  });

  it('returns default state with an ETag', async () => {
    const response = await t.app.inject({ url: url('/leveling'), headers: { cookie } });

    expect(response.json()).toEqual({ id: 'leveling', enabled: false, config: { xpPerMessage: 10, announce: true }, updatedAt: null });
    expect(response.headers.etag).toBe('"default"');
  });

  it('replaces the config, publishes invalidation and records audit', async () => {
    const invalidated = vi.fn();
    const unsubscribe = await subscribeConfigInvalidation(t.redis, t.deps.logger, invalidated);

    const response = await send('PUT', url('/leveling'), { enabled: true, config: { xpPerMessage: 25, announce: false } });
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalledWith({ guildId: GUILD_ID, moduleId: 'leveling' }));
    await unsubscribe();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: true, config: { xpPerMessage: 25, announce: false } });
    expect(response.headers.etag).toBe(`"${response.json().updatedAt}"`);

    const audit = (await t.app.inject({ url: `/v1/guilds/${GUILD_ID}/audit`, headers: { cookie } })).json();
    expect(audit.items[0]).toMatchObject({
      action: 'module.update',
      moduleId: 'leveling',
      diff: { before: { enabled: false }, after: { enabled: true, config: { xpPerMessage: 25 } } },
    });
  });

  it('merges PATCH bodies into the current config', async () => {
    await send('PUT', url('/leveling'), { config: { xpPerMessage: 25, announce: false } });

    const response = await send('PATCH', url('/leveling'), { config: { xpPerMessage: 40 } });

    expect(response.json()).toMatchObject({ config: { xpPerMessage: 40, announce: false } });
  });

  it('rejects invalid configs with details', async () => {
    const response = await send('PUT', url('/leveling'), { config: { xpPerMessage: 0, announce: true } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', details: [{ path: ['xpPerMessage'] }] } });
  });

  it('enforces If-Match', async () => {
    const current = await t.app.inject({ url: url('/leveling'), headers: { cookie } });
    const etag = current.headers.etag as string;
    await send('PATCH', url('/leveling'), { config: { xpPerMessage: 11 } });

    const stale = await send('PATCH', url('/leveling'), { config: { xpPerMessage: 12 } }, { 'if-match': etag });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ error: { code: 'PRECONDITION_FAILED' } });

    const fresh = await t.app.inject({ url: url('/leveling'), headers: { cookie } });
    const ok = await send('PATCH', url('/leveling'), { config: { xpPerMessage: 12 } }, { 'if-match': fresh.headers.etag as string });
    expect(ok.statusCode).toBe(200);
  });

  it('resets to defaults', async () => {
    const response = await send('POST', url('/leveling/reset'));

    expect(response.json()).toMatchObject({ config: { xpPerMessage: 10, announce: true } });
  });

  it('refuses to disable always-enabled modules', async () => {
    const response = await send('PATCH', url('/general'), { enabled: false });

    expect(response.statusCode).toBe(400);
  });

  it('lists all module states', async () => {
    const response = await t.app.inject({ url: url(), headers: { cookie } });

    expect(response.json().map((m: { id: string; enabled: boolean }) => [m.id, m.enabled])).toEqual([
      ['leveling', expect.any(Boolean)],
      ['general', true],
      ['announcer', false],
    ]);
  });

  it('validates channel and role references against the guild snapshot', async () => {
    const ok = await send('PUT', url('/announcer'), { config: { channelId: CHANNEL_ID, roleIds: [ROLE_ID] } });
    expect(ok.statusCode).toBe(200);

    const bad = await send('PUT', url('/announcer'), { config: { channelId: '599999999999999999', roleIds: [GUILD_ID] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details).toEqual([
      { path: ['config', 'channelId'], message: 'Channel 599999999999999999 not found' },
      { path: ['config', 'roleIds', 0], message: 'The bot cannot assign role @everyone' },
    ]);
  });

  it('returns 404 for unknown modules', async () => {
    const response = await t.app.inject({ url: url('/missing'), headers: { cookie } });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'MODULE_NOT_FOUND' } });
  });

  it('mounts module routes behind the guild access check', async () => {
    await send('PATCH', url('/leveling'), { config: { xpPerMessage: 33 } });

    const response = await t.app.inject({ url: url('/leveling/stats'), headers: { cookie } });
    expect(response.json()).toEqual({ guildId: GUILD_ID, xpPerMessage: 33 });

    expect((await t.app.inject(url('/leveling/stats'))).statusCode).toBe(401);
  });
});
