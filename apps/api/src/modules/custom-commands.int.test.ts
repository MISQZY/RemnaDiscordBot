import { modules } from '@bot/module-list';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, GUILD_ID, login, ROLE_ID, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const customCommands = modules.find((m) => m.id === 'custom-commands')!;
const APP_ID = '110000000000000011';

describe('custom commands API', () => {
  let t: TestApp;
  let cookie: string;
  const base = `/v1/guilds/${GUILD_ID}/modules/custom-commands/commands`;
  const guildCommands = `/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const slash = (patch: object = {}) => ({ name: 'rules', kind: 'slash', description: 'Server rules', response: { content: 'Be nice' }, ...patch });

  beforeAll(async () => {
    t = await createTestApp({ modules: [customCommands] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    t.rest.responses.set('/applications/@me', { id: APP_ID });
    t.rest.responses.set(`/applications/${APP_ID}/commands`, [{ name: 'ping' }, { name: 'help' }]);
    await seedGuildSnapshot(t);
    cookie = await login(t);
  });

  beforeEach(async () => {
    t.rest.calls.length = 0;
    await t.database.db.customCommand.deleteMany();
  });

  afterAll(async () => {
    await t.close();
  });

  it('creates a slash command in Discord and stores its id', async () => {
    const response = await send('POST', base, slash());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'rules', kind: 'slash', discordCommandId: expect.stringMatching(/^\d+$/) });
    expect(t.rest.calls.find((c) => c.method === 'post')).toEqual({
      method: 'post',
      route: guildCommands,
      body: expect.objectContaining({ name: 'rules', description: 'Server rules', options: [] }),
    });
  });

  it('creates triggers without touching Discord', async () => {
    const response = await send('POST', base, { name: 'hello', kind: 'trigger', matchMode: 'contains', pattern: 'привет', response: { content: 'Привет!' } });

    expect(response.json()).toMatchObject({ kind: 'trigger', discordCommandId: null });
    expect(t.rest.calls.filter((c) => c.method !== 'get')).toEqual([]);
  });

  it('rejects built-in and duplicate names', async () => {
    const builtIn = await send('POST', base, slash({ name: 'ping' }));
    expect(builtIn.statusCode).toBe(400);
    expect(builtIn.json().error.details).toEqual([{ path: ['name'], message: '/ping already exists' }]);

    await send('POST', base, slash());
    const duplicate = await send('POST', base, slash());
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('validates role actions', async () => {
    const response = await send('POST', base, slash({ actions: { addRoleIds: [GUILD_ID], removeRoleIds: [], deleteTrigger: false } }));
    expect(response.statusCode).toBe(400);
  });

  it('renames by recreating, disables by removing, deletes with Discord', async () => {
    const created = (await send('POST', base, slash())).json();
    const oldId = created.discordCommandId;
    t.rest.calls.length = 0;

    const renamed = (await send('PUT', `${base}/${created.id}`, slash({ name: 'pravila' }))).json();
    expect(t.rest.calls.map((c) => `${c.method} ${c.route}`)).toEqual(
      expect.arrayContaining([`delete ${guildCommands}/${oldId}`, `post ${guildCommands}`]),
    );
    expect(renamed.discordCommandId).not.toBe(oldId);

    t.rest.calls.length = 0;
    const disabled = (await send('PUT', `${base}/${created.id}`, slash({ name: 'pravila', enabled: false }))).json();
    expect(disabled.discordCommandId).toBeNull();
    expect(t.rest.calls.some((c) => c.method === 'delete')).toBe(true);

    const enabled = (await send('PUT', `${base}/${created.id}`, slash({ name: 'pravila', actions: { addRoleIds: [ROLE_ID], removeRoleIds: [], deleteTrigger: false } }))).json();
    t.rest.calls.length = 0;
    expect((await send('DELETE', `${base}/${created.id}`)).statusCode).toBe(204);
    expect(t.rest.calls).toEqual([{ method: 'delete', route: `${guildCommands}/${enabled.discordCommandId}` }]);
  });
});
