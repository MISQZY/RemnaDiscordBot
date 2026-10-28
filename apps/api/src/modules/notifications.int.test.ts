import { modules } from '@bot/module-list';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHANNEL_ID, createTestApp, GUILD_ID, login, ROLE_ID, seedGuildSnapshot, type TestApp } from '../testing/app.js';

const notifications = modules.find((m) => m.id === 'notifications')!;
const YT_CHANNEL = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const feed = `<feed><title>Google Developers</title><entry><yt:videoId>abc</yt:videoId><title>Hi</title></entry></feed>`;

describe('notifications API', () => {
  let t: TestApp;
  let cookie: string;
  const base = `/v1/guilds/${GUILD_ID}/modules/notifications`;
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url: `${base}${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    // Providers are created lazily on the first request — stub the network before it.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(feed)));
    t = await createTestApp({ modules: [notifications] });
    t.oauth.guilds = [{ id: GUILD_ID, name: 'Managed', icon: null, owner: true, permissions: '0' }];
    await seedGuildSnapshot(t);
    cookie = await login(t);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await t.close();
  });

  it('looks up a YouTube channel', async () => {
    expect((await send('GET', `/lookup?provider=youtube&query=${YT_CHANNEL}`)).json()).toEqual({
      externalId: YT_CHANNEL,
      name: 'Google Developers',
      url: `https://www.youtube.com/channel/${YT_CHANNEL}`,
    });
  });

  it('subscribes with a default message, rejects duplicates and manages the subscription', async () => {
    const created = await send('POST', '/subscriptions', { provider: 'youtube', query: YT_CHANNEL, channelId: CHANNEL_ID, mentionRoleId: ROLE_ID });
    expect(created.statusCode).toBe(201);
    const subscription = created.json();
    expect(subscription).toMatchObject({
      provider: 'youtube',
      source: { externalId: YT_CHANNEL, name: 'Google Developers' },
      message: { content: expect.stringContaining('{video.title}') },
    });

    expect((await send('POST', '/subscriptions', { provider: 'youtube', query: YT_CHANNEL, channelId: CHANNEL_ID })).statusCode).toBe(409);

    expect((await send('PATCH', `/subscriptions/${subscription.id}`, { enabled: false })).json()).toMatchObject({ enabled: false });
    expect((await send('GET', '/subscriptions')).json()).toHaveLength(1);

    expect((await send('DELETE', `/subscriptions/${subscription.id}`)).statusCode).toBe(204);
    expect(await t.database.db.notificationSource.count()).toBe(0);
  });

  it('announces what is posted to a webhook, only with its token and while it is enabled', async () => {
    const created = await send('POST', '/subscriptions', {
      provider: 'webhook',
      query: 'CI',
      channelId: CHANNEL_ID,
      message: { content: '{hook.name} {hook.event}: {body.repository.full_name} {body.commits.count} {body.commits.first.message}' },
    });
    expect(created.statusCode).toBe(201);
    const { id, webhook } = created.json() as { id: string; webhook: { url: string } };
    const path = new URL(webhook.url, 'http://x').pathname;
    expect(path).toMatch(new RegExp(`^/v1/public/guilds/${GUILD_ID}/modules/notifications/hooks/${id}/[\\w-]{32}$`));

    const hook = (url: string, payload: object = { repository: { full_name: 'o/r' }, commits: [{ message: 'Fix' }, { message: 'Add' }] }) =>
      t.app.inject({ method: 'POST', url, headers: { 'x-github-event': 'push' }, payload });

    // The module is off until enabled: the public routes do not answer.
    expect((await hook(path)).statusCode).toBe(404);
    await t.app.inject({ method: 'PATCH', url: base, headers: { cookie }, payload: { enabled: true } });

    t.rest.calls.length = 0;
    expect((await hook(path)).statusCode).toBe(204);
    expect(t.rest.calls).toEqual([
      { method: 'post', route: `/channels/${CHANNEL_ID}/messages`, body: expect.objectContaining({ content: 'CI push: o/r 2 Fix' }) },
    ]);
    expect((await hook(path.replace(/[\w-]+$/, 'wrong-token'))).statusCode).toBe(404);

    // A new address: the old one stops working.
    const renewed = (await send('POST', `/subscriptions/${id}/token`)).json() as { webhook: { url: string } };
    expect((await hook(path)).statusCode).toBe(404);
    expect((await hook(new URL(renewed.webhook.url, 'http://x').pathname)).statusCode).toBe(204);

    await send('PATCH', `/subscriptions/${id}`, { enabled: false });
    expect((await hook(new URL(renewed.webhook.url, 'http://x').pathname)).statusCode).toBe(409);

    expect((await send('DELETE', `/subscriptions/${id}`)).statusCode).toBe(204);
    expect(await t.database.db.notificationSource.count()).toBe(0);
  });

  it('limits how often a webhook posts', async () => {
    const { webhook } = (await send('POST', '/subscriptions', { provider: 'webhook', query: 'Spam', channelId: CHANNEL_ID })).json() as { webhook: { url: string } };
    const url = new URL(webhook.url, 'http://x').pathname;
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await t.app.inject({ method: 'POST', url, payload: { text: `#${i}` } })).statusCode);
    expect(codes.filter((c) => c === 204)).toHaveLength(30);
    expect(codes.at(-1)).toBe(429);
  });

  it('validates the channel and reports unconfigured providers', async () => {
    const badChannel = await send('POST', '/subscriptions', { provider: 'youtube', query: YT_CHANNEL, channelId: '599999999999999999' });
    expect(badChannel.statusCode).toBe(400);

    const twitch = await send('POST', '/subscriptions', { provider: 'twitch', query: 'neo', channelId: CHANNEL_ID });
    expect(twitch.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: 'twitch is not configured on this platform' } });
  });
});
