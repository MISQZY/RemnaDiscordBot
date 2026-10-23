import { modules } from '@bot/module-list';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const giveaways = modules.find((m) => m.id === 'giveaways')!;
const USER_A = '710000000000000001';
const USER_B = '710000000000000002';

describe('giveaways', () => {
  let t: TestApp;
  let cookie: string;
  const base = `/v1/guilds/${GUILD_ID}/modules/giveaways/giveaways`;
  const send = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url: `${base}${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestApp({ modules: [giveaways] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    await seedGuildSnapshot(t);
    cookie = await login(t);
  });

  afterAll(async () => {
    await t.close();
  });

  const input = () => ({
    channelId: CHANNEL_ID,
    prize: 'Nitro',
    description: null,
    winners: 1,
    endsAt: new Date(Date.now() + 3600_000).toISOString(),
    requiredRoleIds: [],
    minMemberDays: 0,
  });

  it('posts nothing while the module is off', async () => {
    const refused = await send('POST', '', input());
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('MODULE_DISABLED');
    expect(await t.database.db.giveaway.count()).toBe(0);
  });

  it('starts a giveaway, draws its winners and rerolls one', async () => {
    await t.deps.config.update(GUILD_ID, 'giveaways', { enabled: true });
    const created = await send('POST', '', input());
    expect(created.statusCode).toBe(201);
    const giveaway = created.json();
    expect(giveaway).toMatchObject({ status: 'running', messageId: expect.any(String) });
    expect(await t.database.db.scheduledAction.count({ where: { key: `giveaways:end:${giveaway.id}` } })).toBe(1);

    for (const userId of [USER_A, USER_B]) await t.database.db.giveawayEntry.create({ data: { giveawayId: giveaway.id, userId } });

    const endRes = await send('POST', `/${giveaway.id}/end`, {});
    const ended = endRes.json();
    expect(ended.status).toBe('ended');
    expect(ended.winnerIds).toHaveLength(1);
    expect(await t.database.db.scheduledAction.count({ where: { key: `giveaways:end:${giveaway.id}` } })).toBe(0);

    const rerolled = (await send('POST', `/${giveaway.id}/reroll`, { count: 1 })).json();
    expect(new Set(rerolled.winnerIds)).toEqual(new Set([USER_A, USER_B]));
    expect((await send('POST', `/${giveaway.id}/end`, {})).statusCode).toBe(400);
  });
});
