import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpDiscordOAuth } from './discord-oauth.js';

afterEach(() => vi.restoreAllMocks());

describe('Discord OAuth transport', () => {
  it('bounds credential-bearing requests and refuses redirects', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
    })));
    const oauth = new HttpDiscordOAuth('client', 'secret');
    await expect(oauth.exchangeCode('code', 'https://example.test/callback')).resolves.toMatchObject({ accessToken: 'access' });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });

  it('classifies network failures and broken responses as upstream unavailability', async () => {
    const oauth = new HttpDiscordOAuth('client', 'secret');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('private transport details'))
      .mockResolvedValueOnce(new Response('not JSON'));
    await expect(oauth.getGuilds('access')).rejects.toMatchObject({ code: 'DISCORD_UNAVAILABLE', statusCode: 502 });
    await expect(oauth.getGuilds('access')).rejects.toMatchObject({ code: 'DISCORD_UNAVAILABLE', statusCode: 502 });
  });
});
