import { modules } from '@bot/module-list';
import { ModerationService, type ModerationConfig } from '@bot/module-moderation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const moderation = modules.find((m) => m.id === 'moderation')!;
const MOD = '600000000000000006';
const TARGET = '700000000000000007';

const config: ModerationConfig = {
  logChannelId: CHANNEL_ID,
  dmOnAction: true,
  requireReason: false,
  warnExpiryDays: 30,
  escalation: [{ warns: 2, action: 'mute', durationSec: 3600 }],
};

describe('moderation', () => {
  let t: TestApp;
  let cookie: string;
  let service: ModerationService;
  const base = `/v1/guilds/${GUILD_ID}/modules/moderation`;
  const send = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    t.app.inject({ method, url: `${base}${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestApp({ modules: [moderation] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    t.rest.responses.set(`/guilds/${GUILD_ID}`, { id: GUILD_ID, name: 'Test guild' });
    await seedGuildSnapshot(t);
    cookie = await login(t);
    service = new ModerationService(t.deps);
    await t.deps.config.update(GUILD_ID, 'moderation', { enabled: true, config });
  });

  beforeEach(async () => {
    t.rest.calls.length = 0;
    await t.database.db.modCase.deleteMany();
    await t.database.db.modCaseCounter.deleteMany();
    await t.database.db.scheduledAction.deleteMany();
  });

  afterAll(async () => {
    await t.close();
  });

  const input = (patch: object = {}) => ({ guildId: GUILD_ID, targetId: TARGET, moderatorId: MOD, reason: 'spam', ...patch });

  it('bans temporarily: DM, Discord ban, case, scheduled unban and log', async () => {
    const modCase = await service.ban(input({ durationSec: 3600 }), config);

    expect(modCase).toMatchObject({ number: 1, type: 'ban', durationSec: 3600 });
    const routes = t.rest.calls.map((c) => `${c.method} ${c.route}`);
    expect(routes).toEqual([
      `get /guilds/${GUILD_ID}`,
      'post /users/@me/channels',
      expect.stringMatching(/^post \/channels\/\d+\/messages$/),
      `put /guilds/${GUILD_ID}/bans/${TARGET}`,
      `post /channels/${CHANNEL_ID}/messages`,
    ]);
    expect(t.rest.calls[2]!.body).toMatchObject({ content: expect.stringContaining('**Test guild**') });
    expect(t.rest.calls.at(-1)!.body).toMatchObject({ embeds: [{ title: 'Кейс #1 · Бан' }] });

    const scheduled = await t.database.db.scheduledAction.findUnique({ where: { key: `moderation:unban:${GUILD_ID}:${TARGET}` } });
    expect(scheduled).toMatchObject({ type: 'moderation:unban', payload: { userId: TARGET } });
  });

  it('escalates warnings into a mute with sequential case numbers', async () => {
    await service.warn(input(), config);
    const { escalated } = await service.warn(input(), config);

    expect(escalated).toMatchObject({ number: 3, type: 'mute', moderatorId: 'system', reason: 'Автоматически: 2 предупреждения' });
    const timeout = t.rest.calls.find((c) => c.method === 'patch');
    expect(timeout).toMatchObject({ route: `/guilds/${GUILD_ID}/members/${TARGET}`, body: { communication_disabled_until: expect.any(String) } });
  });

  it('lists, reads and edits cases through the API', async () => {
    for (let i = 0; i < 3; i++) await service.kick(input(), config);

    const page = (await send('GET', '/cases?limit=2')).json();
    expect(page.items.map((c: { number: number }) => c.number)).toEqual([3, 2]);
    expect(page.nextBefore).toBe(2);
    expect((await send('GET', `/cases?before=${page.nextBefore}`)).json().items).toHaveLength(1);

    expect((await send('PATCH', '/cases/2', { reason: 'flood' })).json()).toMatchObject({ number: 2, reason: 'flood', active: false });
    expect((await send('GET', '/cases/99')).statusCode).toBe(404);
  });

  it('revokes a ban: unbans, cancels the scheduled unban and records a case', async () => {
    await service.ban(input({ durationSec: 3600 }), config);
    t.rest.calls.length = 0;

    const revoked = await send('POST', '/cases/1/revoke', { reason: 'appeal' });

    expect(revoked.json()).toMatchObject({ number: 2, type: 'unban', moderatorId: expect.any(String) });
    expect(t.rest.calls.some((c) => c.method === 'delete' && c.route === `/guilds/${GUILD_ID}/bans/${TARGET}`)).toBe(true);
    expect(await t.database.db.scheduledAction.count()).toBe(0);
    expect((await send('GET', '/cases/1')).json()).toMatchObject({ active: false, revokeReason: 'appeal' });
  });

  it('revokes warnings and reports inactive cases', async () => {
    await service.warn(input(), config);

    expect((await send('GET', `/users/${TARGET}/warnings`)).json()).toHaveLength(1);
    expect((await send('POST', '/cases/1/revoke', {})).json()).toMatchObject({ type: 'warn', active: false });
    expect((await send('GET', `/users/${TARGET}/warnings`)).json()).toHaveLength(0);
    expect((await send('POST', '/cases/1/revoke', {})).statusCode).toBe(400);
  });
});
