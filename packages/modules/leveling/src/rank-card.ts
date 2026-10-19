import type { Locale } from '@bot/contracts';

/** What the renderer draws: the member as the server shows them and their figures there. */
export interface RankCardRequest {
  locale: Locale;
  user: { id: string; name: string; avatarUrl: string | null };
  level: number;
  rank: number;
  /** XP within the level and the XP the level takes. */
  current: number;
  needed: number;
  messages: number;
}

const TIMEOUT_MS = 8_000;

export interface RankCardRenderer {
  render(request: RankCardRequest): Promise<Buffer>;
}

/**
 * The `/rank` picture from an external renderer (RemnaWeb's `POST /api/discord/cards/rank`): `RANK_CARD_URL`, with
 * `RANK_CARD_SECRET` as a bearer token. It also dresses the card in the cosmetics of whoever linked that Discord
 * account there. Null when not configured: `/rank` answers with an embed.
 */
export function rankCardRendererFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): RankCardRenderer | null {
  const url = env.RANK_CARD_URL?.trim();
  const secret = env.RANK_CARD_SECRET?.trim();
  if (!url || !secret) return null;
  return {
    async render(request) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Rank card renderer answered ${response.status}`);
      if (!response.headers.get('content-type')?.startsWith('image/png')) throw new Error('Rank card renderer sent no PNG');
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
