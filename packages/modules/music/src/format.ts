import type { LavalinkNodeOptions, SearchPlatform } from 'lavalink-client';
import type { SearchSource } from './config.js';

export const SEARCH_PLATFORMS: Record<SearchSource, SearchPlatform> = {
  soundcloud: 'scsearch',
  bandcamp: 'bcsearch',
  youtube: 'ytsearch',
  youtubemusic: 'ytmsearch',
  deezer: 'dzsearch',
  spotify: 'spsearch',
  yandexmusic: 'ymsearch',
};

/** `3:07`, `1:02:03`; streams have no length. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** `1:30`, `90`, `1:02:03` → milliseconds; null when unparsable. */
export function parseTimestamp(input: string): number | null {
  const parts = input.trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
  const seconds = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  return seconds * 1000;
}

export function progressBar(position: number, duration: number, width = 14): string {
  if (duration <= 0) return '▬'.repeat(width);
  const filled = Math.min(width - 1, Math.floor((position / duration) * width));
  return `${'▬'.repeat(filled)}🔘${'▬'.repeat(width - filled - 1)}`;
}

/** Discord markdown link text: no brackets that would break `[title](url)`. */
export function escapeTitle(title: string, max = 80): string {
  const clean = title.replace(/[[\]()*_`~|\\]/g, '').trim() || '—';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * `LAVALINK_NODES`: comma-separated `lavalink://<password>@<host>:<port>`, `lavalinks://` for TLS.
 * Nodes are named by their host and port.
 */
export function parseLavalinkNodes(value: string | undefined): LavalinkNodeOptions[] {
  if (!value?.trim()) return [];
  return value.split(',').map((raw) => {
    const url = new URL(raw.trim());
    if (url.protocol !== 'lavalink:' && url.protocol !== 'lavalinks:') {
      throw new Error(`LAVALINK_NODES: expected lavalink:// or lavalinks://, got "${url.protocol}"`);
    }
    const secure = url.protocol === 'lavalinks:';
    const port = Number(url.port) || (secure ? 443 : 2333);
    return {
      id: `${url.hostname}:${port}`,
      host: url.hostname,
      port,
      secure,
      authorization: decodeURIComponent(url.username || url.password),
      retryAmount: Number.POSITIVE_INFINITY,
      retryDelay: 10_000,
    };
  });
}
