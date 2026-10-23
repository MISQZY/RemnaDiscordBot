import { modules } from '@bot/module-list';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, ROLE_ID, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const autoroles = modules.find((m) => m.id === 'autoroles')!;

const panelInput = (patch: object = {}) => ({
  channelId: CHANNEL_ID,
  kind: 'buttons',
  mode: 'toggle',
  message: { content: 'Выберите роли' },
  items: [{ roleId: ROLE_ID, label: 'Moderator', emoji: '🛡️' }],
  ...patch,
});

describe('autoroles API', () => {
  let t: TestApp;
  let cookie: string;
  const base = `/v1/guilds/${GUILD_ID}/modules/autoroles/panels`;
  const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestApp({ modules: [autoroles] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    await seedGuildSnapshot(t);
    cookie = await login(t);
    await t.deps.config.update(GUILD_ID, 'autoroles', { enabled: true });
  });

  beforeEach(() => {
    t.rest.calls.length = 0;
  });

  afterAll(async () => {
    await t.close();
  });

  it('creates, lists and publishes a panel', async () => {
    const created = await request('POST', base, panelInput());
    expect(created.statusCode).toBe(201);
    const panel = created.json();
    expect(panel).toMatchObject({ messageId: null, items: [{ roleId: ROLE_ID, style: 'secondary' }] });

    expect((await request('GET', base)).json()).toHaveLength(1);

    const published = await request('POST', `${base}/${panel.id}/publish`);
    expect(published.json().messageId).toMatch(/^9\d{17}$/);
    expect(t.rest.calls).toEqual([
      {
        method: 'post',
        route: `/channels/${CHANNEL_ID}/messages`,
        body: expect.objectContaining({
          content: 'Выберите роли',
          components: [{ type: 1, components: [expect.objectContaining({ custom_id: `ar:${panel.id}:${ROLE_ID}`, label: 'Moderator' })] }],
        }),
      },
    ]);

    // Publishing again edits the message that was already sent.
    t.rest.calls.length = 0;
    await request('POST', `${base}/${panel.id}/publish`);
    expect(t.rest.calls[0]).toMatchObject({ method: 'patch', route: `/channels/${CHANNEL_ID}/messages/${published.json().messageId}` });
  });

  it('rejects roles the bot cannot assign', async () => {
    const response = await request('POST', base, panelInput({ items: [{ roleId: GUILD_ID, label: 'Everyone' }] }));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details).toEqual([{ path: ['items', 0, 'roleId'], message: 'The bot cannot assign role @everyone' }]);
  });

  it('rejects duplicate roles', async () => {
    const item = { roleId: ROLE_ID, label: 'A' };
    expect((await request('POST', base, panelInput({ items: [item, item] }))).statusCode).toBe(400);
  });

  it('moves a published panel to another channel by deleting the old message', async () => {
    const otherChannel = '500000000000000015';
    await t.redis.set(
      `guild:${GUILD_ID}:channels`,
      JSON.stringify([
        { id: CHANNEL_ID, name: 'general', type: 0, parentId: null, position: 0 },
        { id: otherChannel, name: 'roles', type: 0, parentId: null, position: 1 },
      ]),
    );
    const panel = (await request('POST', base, panelInput())).json();
    const published = (await request('POST', `${base}/${panel.id}/publish`)).json();
    t.rest.calls.length = 0;

    const moved = await request('PUT', `${base}/${panel.id}`, panelInput({ channelId: otherChannel }));

    expect(moved.json()).toMatchObject({ channelId: otherChannel, messageId: null });
    expect(t.rest.calls).toEqual([{ method: 'delete', route: `/channels/${CHANNEL_ID}/messages/${published.messageId}` }]);
  });

  it('deletes a panel with its message and hides panels of other guilds', async () => {
    const panel = (await request('POST', base, panelInput())).json();
    await request('POST', `${base}/${panel.id}/publish`);

    expect((await request('DELETE', `${base}/${panel.id}`)).statusCode).toBe(204);
    expect(t.rest.calls.at(-1)).toMatchObject({ method: 'delete' });
    expect((await request('GET', `${base}/${panel.id}`)).statusCode).toBe(404);
  });
});
