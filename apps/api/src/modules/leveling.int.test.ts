import { modules } from '@bot/module-list';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, GUILD_ID, login, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const leveling = modules.find((m) => m.id === 'leveling')!;

describe('leveling API', () => {
  let t: TestApp;
  let cookie: string;
  const base = `/v1/guilds/${GUILD_ID}/modules/leveling`;

  beforeAll(async () => {
    t = await createTestApp({ modules: [leveling] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    await seedGuildSnapshot(t);
    cookie = await login(t);
    await t.database.db.memberLevel.createMany({
      data: [
        { guildId: GUILD_ID, userId: '800000000000000001', xp: 300, level: 2, messages: 20, username: 'neo' },
        { guildId: GUILD_ID, userId: '800000000000000002', xp: 900, level: 4, messages: 50, username: 'trinity' },
      ],
    });
  });

  afterAll(async () => {
    await t.close();
  });

  it('returns the leaderboard with progress', async () => {
    const response = await t.app.inject({ url: `${base}/leaderboard`, headers: { cookie } });

    expect(response.json()).toMatchObject({
      total: 2,
      items: [
        { rank: 1, username: 'trinity', level: 4 },
        { rank: 2, username: 'neo', xp: 300, progress: { current: 45, needed: 220 } },
      ],
    });
  });

  it('sets member XP and recalculates the level', async () => {
    const response = await t.app.inject({
      method: 'PATCH',
      url: `${base}/members/800000000000000001`,
      headers: { cookie },
      payload: { xp: 1000 },
    });

    expect(response.json()).toMatchObject({ rank: 1, xp: 1000, level: 4 });
  });

  it('exposes the public leaderboard only when allowed and enabled', async () => {
    const publicUrl = `/v1/public/guilds/${GUILD_ID}/modules/leveling/leaderboard`;
    expect((await t.app.inject(publicUrl)).statusCode).toBe(404);

    await t.app.inject({
      method: 'PATCH',
      url: base,
      headers: { cookie },
      payload: { enabled: true, config: { publicLeaderboard: true } },
    });

    const response = await t.app.inject(publicUrl);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
  });

  it('requires explicit confirmation to reset', async () => {
    expect((await t.app.inject({ method: 'POST', url: `${base}/reset`, headers: { cookie }, payload: {} })).statusCode).toBe(400);
    const reset = await t.app.inject({ method: 'POST', url: `${base}/reset`, headers: { cookie }, payload: { confirm: true } });
    expect(reset.json()).toEqual({ deleted: 2 });
  });
});
