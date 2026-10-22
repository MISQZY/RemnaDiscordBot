import type { Track, UnresolvedTrack } from 'lavalink-client';
import type { TrackView } from './state.js';

/** What a queued track keeps of the member who requested it. */
export interface Requester {
  id: string;
  username: string;
}

export function requesterOf(track: Track | UnresolvedTrack | null | undefined): Requester | null {
  const requester = track?.requester as Partial<Requester> | undefined;
  return requester?.id ? { id: requester.id, username: requester.username ?? '' } : null;
}

export function trackView(track: Track | UnresolvedTrack): TrackView {
  return {
    title: track.info.title,
    author: track.info.author ?? '',
    uri: track.info.uri ?? null,
    artworkUrl: track.info.artworkUrl ?? null,
    durationMs: track.info.duration ?? 0,
    isStream: track.info.isStream ?? false,
    requesterId: requesterOf(track)?.id ?? null,
  };
}

/** Literal IPs of loopback, private, link-local, CGNAT and unique-local ranges. */
const PRIVATE_IP = /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?(?:::1?|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]?:|::ffff:))/i;

/**
 * Whether a link may go to the audio server. Lavalink's http source fetches whatever it is given from inside the
 * stack's network, so a link to an internal service (`http://api:3000`, a private or metadata IP) is refused: only
 * http(s) to a public host name or address. Search text, not a link, is always fine.
 */
export function playableQuery(query: string): boolean {
  if (!/^[a-z][a-z\d+.-]*:/i.test(query.trim())) return true;
  let url: URL;
  try {
    url = new URL(query.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') && !host.includes(':')) return false;
  if (host === 'localhost' || /\.(?:localhost|local|internal|lan|home|arpa)$/.test(host)) return false;
  return !PRIVATE_IP.test(host);
}
