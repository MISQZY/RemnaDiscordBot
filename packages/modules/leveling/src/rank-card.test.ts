import { describe, expect, it, vi } from 'vitest';
import { rankCardRendererFromEnv, type RankCardRequest } from './rank-card.js';

const request: RankCardRequest = {
  locale: 'ru',
  user: { id: '1', name: 'Neo', avatarUrl: null },
  level: 5,
  rank: 2,
  current: 10,
  needed: 100,
  messages: 42,
};
const env = { RANK_CARD_URL: 'https://web.test/api/discord/cards/rank', RANK_CARD_SECRET: 'secret' };

describe('rankCardRendererFromEnv', () => {
  it('is off without the URL or the secret', () => {
    expect(rankCardRendererFromEnv({})).toBeNull();
    expect(rankCardRendererFromEnv({ RANK_CARD_URL: env.RANK_CARD_URL })).toBeNull();
  });

  it('posts the figures with the bearer secret and returns the PNG', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    const png = await rankCardRendererFromEnv(env, fetchImpl as typeof fetch)!.render(request);

    expect([...png]).toEqual([1, 2, 3]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(env.RANK_CARD_URL);
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret' });
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('fails on an error or anything but a PNG', async () => {
    const failing = vi.fn(async () => new Response('no', { status: 401 }));
    await expect(rankCardRendererFromEnv(env, failing as typeof fetch)!.render(request)).rejects.toThrow('401');
    const html = vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    await expect(rankCardRendererFromEnv(env, html as typeof fetch)!.render(request)).rejects.toThrow('PNG');
  });
});
