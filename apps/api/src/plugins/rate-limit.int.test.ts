import { defineModule } from '@bot/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, GUILD_ID, login, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const module = defineModule({
  id: 'leveling',
  configSchema: z.object({ xpPerMessage: z.number().int() }),
  defaultConfig: { xpPerMessage: 10 },
  configVersion: 1,
});

describe('rate limiting', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ modules: [module], rateLimitPerMinute: 100 });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    await seedGuildSnapshot(t);
  });

  afterAll(async () => {
    await t.close();
  });

  it('limits config writes per guild and reports RATE_LIMITED', async () => {
    const cookie = await login(t);
    const patch = () =>
      t.app.inject({
        method: 'PATCH',
        url: `/v1/guilds/${GUILD_ID}/modules/leveling`,
        headers: { cookie },
        payload: { config: { xpPerMessage: 11 } },
      });

    for (let i = 0; i < 20; i++) expect((await patch()).statusCode).toBe(200);
    const limited = await patch();

    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('applies the global limit per client but not to health checks', async () => {
    const limited = await createTestApp({ rateLimitPerMinute: 3 });
    try {
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await limited.app.inject('/v1/status')).statusCode);
      expect(statuses).toEqual([200, 200, 200, 429]);

      for (let i = 0; i < 5; i++) expect((await limited.app.inject('/health')).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
