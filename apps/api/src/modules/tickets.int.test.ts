import { modules } from '@bot/module-list';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, ROLE_ID, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const tickets = modules.find((m) => m.id === 'tickets')!;
const OWNER = '700000000000000007';
const LOG = '800000000000000008';

describe('tickets', () => {
  let t: TestApp;
  let cookie: string;
  const base = `/v1/guilds/${GUILD_ID}/modules/tickets`;
  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url: `${base}${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestApp({ modules: [tickets] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    t.rest.responses.set(`/guilds/${GUILD_ID}`, { id: GUILD_ID, name: 'Test guild' });
    await seedGuildSnapshot(t);
    cookie = await login(t);
    await t.deps.config.update(GUILD_ID, 'tickets', { enabled: true });
  });

  beforeEach(async () => {
    t.rest.calls.length = 0;
    await t.database.db.ticket.deleteMany();
    await t.database.db.ticketPanel.deleteMany();
  });

  afterAll(async () => {
    await t.close();
  });

  it('creates a panel with category and question ids and publishes it', async () => {
    const created = await send('POST', '/panels', {
      channelId: CHANNEL_ID,
      kind: 'buttons',
      message: { content: 'Нужна помощь?' },
      categories: [{ label: 'Оплата', questions: [{ label: 'Номер заказа', required: true, long: false }], supportRoleIds: [ROLE_ID] }],
    });
    expect(created.statusCode).toBe(201);
    const panel = created.json();
    const category = panel.categories[0];
    expect(category).toMatchObject({ id: expect.any(String), style: 'primary', questions: [{ id: expect.any(String) }] });

    const published = (await send('POST', `/panels/${panel.id}/publish`)).json();
    expect(published.messageId).toBeTruthy();
    expect(t.rest.calls[0]).toMatchObject({
      method: 'post',
      route: `/channels/${CHANNEL_ID}/messages`,
      body: { components: [{ components: [expect.objectContaining({ custom_id: `tk:open:${panel.id}:${category.id}` })] }] },
    });

    // Saving the panel again keeps the ids the posted buttons carry.
    const updated = (await send('PUT', `/panels/${panel.id}`, { ...panel, categories: [{ ...category, label: 'Платежи' }] })).json();
    expect(updated.categories[0].id).toBe(category.id);
    expect(updated.categories[0].questions[0].id).toBe(category.questions[0].id);
  });

  it('refuses categories with unknown support roles', async () => {
    const created = await send('POST', '/panels', {
      channelId: CHANNEL_ID,
      kind: 'select',
      message: { content: 'x' },
      categories: [{ label: 'A', questions: [], supportRoleIds: ['999999999999999999'] }],
    });
    expect(created.statusCode).toBe(400);
  });

  it('closes a ticket from the dashboard with a transcript in the log', async () => {
    await t.deps.config.update(GUILD_ID, 'tickets', {
      enabled: true,
      config: { ...tickets.defaultConfig, mode: 'channel', parentChannelId: CHANNEL_ID, logChannelId: LOG },
    });
    const ticket = await t.database.db.ticket.create({ data: { guildId: GUILD_ID, number: 7, channelId: '900000000000000099', ownerId: OWNER } });
    t.rest.responses.set(`/channels/${ticket.channelId}`, { id: ticket.channelId, type: 0 });

    const closed = await send('POST', '/tickets/7/close', { reason: 'solved' });
    expect(closed.json()).toMatchObject({ number: 7, status: 'closed', closeReason: 'solved' });
    expect(t.rest.calls.some((c) => c.method === 'post' && c.route === `/channels/${LOG}/messages`)).toBe(true);
    expect(t.rest.calls.some((c) => c.method === 'delete' && c.route === `/channels/${ticket.channelId}`)).toBe(true);

    const page = (await send('GET', '/tickets?status=closed')).json();
    expect(page.items.map((i: { number: number }) => i.number)).toEqual([7]);
    expect((await send('POST', '/tickets/7/close', {})).statusCode).toBe(400);
  });
});
