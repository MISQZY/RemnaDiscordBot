import { defineModule, EntityChecker, subscribeConfigInvalidation } from '@bot/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, ROLE_ID, seedGuildSnapshot, type TestApp } from '../testing/app.js';
import { TEST_USER } from '../testing/fake-oauth.js';

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
    app.post('/stats', async () => ({ written: true }));
    app.get('/stats', async (request) => {
      const { guildId } = request.params as { guildId: string };
      return { guildId, xpPerMessage: (await ctx.getConfig(guildId)).xpPerMessage };
    });
  },
  publicApi: (app) => {
    app.get('/board', async () => ({ public: true }));
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

let hookShouldFail = false;
let hookCallCount = 0;
const hookDiffs: unknown[] = [];

const hooked = defineModule({
  id: 'hooked',
  configSchema: z.object({ value: z.string().default('init') }),
  defaultConfig: { value: 'init' },
  configVersion: 1,
  onSaved: async (_ctx, diff) => {
    hookDiffs.push(diff);
    hookCallCount++;
    if (hookShouldFail) throw new Error('External service unreachable');
  },
});

describe('module routes', () => {
  let t: TestApp;
  let cookie: string;
  const url = (suffix = '') => `/v1/guilds/${GUILD_ID}/modules${suffix}`;
  const send = (method: 'PUT' | 'PATCH' | 'POST', path: string, payload?: object, headers: Record<string, string> = {}) =>
    t.app.inject({ method, url: path, headers: { cookie, ...headers }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestApp({ modules: [leveling, general, announcer, hooked] });
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

    expect(response.json()).toEqual({
      id: 'leveling',
      enabled: false,
      config: { xpPerMessage: 10, announce: true },
      updatedAt: null,
      applied: true,
      applyError: null,
    });
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
      ['hooked', false],
    ]);
    expect(response.json()[0]).toHaveProperty('config');
  });

  it('supports compact listing for catalog and guild modules to reduce data transfer', async () => {
    // 1. Catalog without schemas
    const compactCatalog = await t.app.inject('/v1/modules?compact=true');
    expect(compactCatalog.statusCode).toBe(200);
    expect(compactCatalog.json()[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    expect(compactCatalog.json()[0]).not.toHaveProperty('configSchema');

    const fullCatalog = await t.app.inject('/v1/modules');
    expect(fullCatalog.statusCode).toBe(200);
    expect(fullCatalog.json()[0]).toHaveProperty('configSchema');
    const explicitFull = await t.app.inject('/v1/modules?compact=false');
    expect(explicitFull.json()[0]).toHaveProperty('configSchema');

    // 2. Guild modules without heavy configs
    const compactModules = await t.app.inject({ url: `${url()}?compact=true`, headers: { cookie } });
    expect(compactModules.statusCode).toBe(200);
    expect(compactModules.json()[0]).toMatchObject({ id: expect.any(String), enabled: expect.any(Boolean), applied: expect.any(Boolean) });
    expect(compactModules.json()[0]).not.toHaveProperty('config');
    const fullModules = await t.app.inject({ url: `${url()}?compact=false`, headers: { cookie } });
    expect(fullModules.json()[0]).toHaveProperty('config');
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

  it('diagnoses module configuration, permissions and dependencies', async () => {
    // 1. With valid config
    await send('PUT', url('/announcer'), { config: { channelId: CHANNEL_ID, roleIds: [ROLE_ID] } });
    const diagOk = await t.app.inject({ url: url('/announcer/diagnose'), headers: { cookie } });
    expect(diagOk.statusCode).toBe(200);
    expect(diagOk.json()).toEqual({ valid: true, issues: [] });

    // 2. Draft diagnose with unassignable role or non-existent channel via POST
    const diagDraft = await t.app.inject({
      method: 'POST',
      url: url('/announcer/diagnose'),
      headers: { cookie },
      payload: { config: { channelId: '599999999999999999', roleIds: [GUILD_ID] } },
    });
    expect(diagDraft.statusCode).toBe(200);
    expect(diagDraft.json().valid).toBe(false);
    expect(diagDraft.json().issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          field: 'roleIds.0',
          message: expect.stringContaining('@everyone'),
          action: expect.any(String),
        }),
        expect.objectContaining({
          severity: 'error',
          field: 'channelId',
          message: expect.stringContaining('599999999999999999'),
          action: expect.any(String),
        }),
      ]),
    );

    const malformed = await t.app.inject({ method: 'POST', url: url('/announcer/diagnose'), headers: { cookie }, payload: { config: { roleIds: 12 } } });
    expect(malformed.statusCode).toBe(400);

    // 3. Stored diagnose when channel was deleted afterwards
    await t.deps.config.update(GUILD_ID, 'announcer', { config: { channelId: '599999999999999999', roleIds: [] } });
    const diagDeleted = await t.app.inject({ url: url('/announcer/diagnose'), headers: { cookie } });
    expect(diagDeleted.statusCode).toBe(200);
    expect(diagDeleted.json().valid).toBe(false);
    expect(diagDeleted.json().issues[0]).toMatchObject({
      severity: 'error',
      field: 'channelId',
      action: expect.any(String),
    });
  });

  it('switches a module on and off though its saved config points at a deleted channel', async () => {
    await t.deps.config.update(GUILD_ID, 'announcer', { config: { channelId: '599999999999999999', roleIds: [] } });

    expect((await send('PATCH', url('/announcer'), { enabled: true })).statusCode).toBe(200);
    const off = await send('PUT', url('/announcer'), { enabled: false, config: { channelId: '599999999999999999', roleIds: [] } });
    expect(off.statusCode).toBe(200);
    expect((await send('PATCH', url('/announcer'), { config: { channelId: '599999999999999998' } })).statusCode).toBe(400);
  });

  it('serves public module routes only while the module is enabled', async () => {
    const publicUrl = `/v1/public/guilds/${GUILD_ID}/modules/leveling/board`;
    await send('PATCH', url('/leveling'), { enabled: false });
    expect((await t.app.inject(publicUrl)).statusCode).toBe(404);

    await send('PATCH', url('/leveling'), { enabled: true });
    const response = await t.app.inject(publicUrl);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ public: true });
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

  it('distinguishes saved from applied when onSaved hook fails and allows retry', async () => {
    hookCallCount = 0;
    hookDiffs.length = 0;
    hookShouldFail = true;

    // 1. Save succeeds, but onSaved fails -> applied: false, applyError is returned
    const failRes = await send('PUT', url('/hooked'), { enabled: true, config: { value: 'v1' } });
    expect(failRes.statusCode).toBe(200);
    expect(failRes.json()).toMatchObject({
      enabled: true,
      config: { value: 'v1' },
      applied: false,
      applyError: 'External service unreachable',
    });
    expect(hookCallCount).toBe(1);

    // 2. Subsequent GET returns applied: false
    const getRes = await t.app.inject({ url: url('/hooked'), headers: { cookie } });
    expect(getRes.headers.etag).toBe(failRes.headers.etag);
    expect(getRes.json()).toMatchObject({
      applied: false,
      applyError: 'External service unreachable',
    });

    // 3. Retry when hook still fails
    const retryFail = await send('POST', url('/hooked/retry-apply'));
    expect(retryFail.statusCode).toBe(200);
    expect(retryFail.json()).toMatchObject({
      applied: false,
      applyError: 'External service unreachable',
    });
    expect(hookCallCount).toBe(2);

    // 4. Retry succeeds
    hookShouldFail = false;
    const retryOk = await send('POST', url('/hooked/retry-apply'));
    expect(retryOk.statusCode).toBe(200);
    expect(retryOk.json()).toMatchObject({
      applied: true,
      applyError: null,
    });
    expect(hookCallCount).toBe(3);
    expect(retryOk.headers.etag).toBe(failRes.headers.etag);
    expect(hookDiffs[1]).toEqual(hookDiffs[0]);
    expect(hookDiffs[2]).toEqual(hookDiffs[0]);

    // 5. Duplicate retry does not re-run hook
    const noopRetry = await send('POST', url('/hooked/retry-apply'));
    expect(noopRetry.statusCode).toBe(200);
    expect(noopRetry.json()).toMatchObject({
      applied: true,
      applyError: null,
    });
    expect(hookCallCount).toBe(3); // unchanged

    // 6. Audit log recorded
    const audit = (await t.app.inject({ url: `/v1/guilds/${GUILD_ID}/audit`, headers: { cookie } })).json();
    expect(audit.items[0]).toMatchObject({
      action: 'module.retry_apply',
      moduleId: 'hooked',
    });
  });

  it('protects retry-apply against concurrent execution with 409 Conflict', async () => {
    await t.deps.redis.set(`lock:apply:${GUILD_ID}:hooked`, '1', 'EX', 10);
    try {
      const res = await send('POST', url('/hooked/retry-apply'));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    } finally {
      await t.deps.redis.del(`lock:apply:${GUILD_ID}:hooked`);
    }
  });

  it('does not mark a newer configuration applied when an older hook finishes', async () => {
    const old = await t.deps.config.update(GUILD_ID, 'hooked', { config: { value: 'old' } });
    const fresh = await t.deps.config.update(GUILD_ID, 'hooked', { config: { value: 'fresh' } });
    await t.deps.config.setApplied(GUILD_ID, 'hooked', true, null, old.updatedAt);
    const state = await t.deps.config.get(GUILD_ID, 'hooked');
    expect(state).toMatchObject({ config: { value: 'fresh' }, applied: false, updatedAt: fresh.updatedAt });
  });

  it('lets moderators read module data without changing non-moderation resources', async () => {
    const isolated = await createTestApp({ modules: [leveling] });
    try {
      isolated.oauth.guilds = [{ id: GUILD_ID, name: 'Moderated', icon: null, owner: false, permissions: '0' }];
      await seedGuildSnapshot(isolated);
      await isolated.deps.db.guild.create({ data: { id: GUILD_ID, modRoleIds: [ROLE_ID] } });
      isolated.rest.responses.set(`/guilds/${GUILD_ID}/members/${TEST_USER.id}`, { roles: [ROLE_ID] });
      const moderatorCookie = await login(isolated);
      const read = await isolated.app.inject({ url: url('/leveling/stats'), headers: { cookie: moderatorCookie } });
      expect(read.statusCode).toBe(200);
      const write = await isolated.app.inject({ method: 'POST', url: url('/leveling/stats'), headers: { cookie: moderatorCookie } });
      expect(write.statusCode).toBe(403);
    } finally {
      await isolated.close();
    }
  });
});
