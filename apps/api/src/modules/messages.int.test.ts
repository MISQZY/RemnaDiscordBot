import { modules } from '@bot/module-list';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const messagesModule = modules.find((m) => m.id === 'messages')!;

describe('messages', () => {
  let t: TestApp;
  let cookie: string;
  const base = `/v1/guilds/${GUILD_ID}/modules/messages`;
  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url: `${base}${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestApp({ modules: [messagesModule] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    t.rest.responses.set(`/guilds/${GUILD_ID}`, { id: GUILD_ID, name: 'Test guild', approximate_member_count: 42 });
    await seedGuildSnapshot(t);
    cookie = await login(t);
    await t.deps.config.update(GUILD_ID, 'messages', { enabled: true });
  });

  beforeEach(async () => {
    t.rest.calls.length = 0;
    await t.database.db.scheduledAction.deleteMany();
  });

  afterAll(async () => {
    await t.close();
  });

  it('posts a message with server placeholders, edits and deletes it', async () => {
    const created = await send('POST', '/sent', { channelId: CHANNEL_ID, message: { content: 'Welcome to {guild.name}: {guild.memberCount}' } });
    expect(created.statusCode).toBe(201);
    const posted = t.rest.calls.find((c) => c.method === 'post');
    expect(posted).toMatchObject({ route: `/channels/${CHANNEL_ID}/messages`, body: { content: 'Welcome to Test guild: 42' } });

    const { id, messageId } = created.json();
    t.rest.calls.length = 0;
    expect((await send('PUT', `/sent/${id}`, { message: { content: 'Edited' } })).json()).toMatchObject({ message: { content: 'Edited' } });
    expect(t.rest.calls.find((c) => c.method === 'patch')).toMatchObject({ route: `/channels/${CHANNEL_ID}/messages/${messageId}` });

    expect((await send('DELETE', `/sent/${id}`)).statusCode).toBe(204);
    expect((await send('GET', '/sent')).json()).toEqual([]);
  });

  it('schedules a repeating message and refuses times in the past', async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    const created = await send('POST', '/scheduled', { channelId: CHANNEL_ID, message: { content: 'Daily' }, nextRunAt: at, intervalMin: 1440, enabled: true });
    expect(created.statusCode).toBe(201);
    const job = await t.database.db.scheduledAction.findUnique({ where: { key: `messages:scheduled:${created.json().id}` } });
    expect(job).toMatchObject({ type: 'messages:scheduled', runAt: new Date(at) });

    const past = await send('POST', '/scheduled', { channelId: CHANNEL_ID, message: { content: 'x' }, nextRunAt: '2020-01-01T00:00:00Z', intervalMin: 0, enabled: true });
    expect(past.statusCode).toBe(400);

    // Turning it off drops the pending run.
    await send('PUT', `/scheduled/${created.json().id}`, { ...created.json(), enabled: false });
    expect(await t.database.db.scheduledAction.count()).toBe(0);
  });


  it('keeps a sticky message at the bottom: posts it and replaces its copy', async () => {
    const saved = (await send('PUT', `/sticky/${CHANNEL_ID}`, { message: { content: 'Read the rules' }, enabled: true })).json();
    expect(saved.lastMessageId).toBeTruthy();
    expect(await t.deps.redis.exists(`messages:sticky:${CHANNEL_ID}`)).toBe(1);

    t.rest.calls.length = 0;
    await send('PUT', `/sticky/${CHANNEL_ID}`, { message: { content: 'Read the rules!' }, enabled: true });
    expect(t.rest.calls.map((c) => c.method)).toContain('delete');

    expect((await send('DELETE', `/sticky/${CHANNEL_ID}`)).statusCode).toBe(204);
    expect(await t.deps.redis.exists(`messages:sticky:${CHANNEL_ID}`)).toBe(0);
  });
});
