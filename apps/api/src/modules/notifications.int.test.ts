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
    // Провайдеры создаются лениво при первом запросе — подменяем сеть до него.
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

  it('validates the channel and reports unconfigured providers', async () => {
    const badChannel = await send('POST', '/subscriptions', { provider: 'youtube', query: YT_CHANNEL, channelId: '599999999999999999' });
    expect(badChannel.statusCode).toBe(400);

    const twitch = await send('POST', '/subscriptions', { provider: 'twitch', query: 'neo', channelId: CHANNEL_ID });
    expect(twitch.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: 'twitch is not configured on this platform' } });
  });
});
