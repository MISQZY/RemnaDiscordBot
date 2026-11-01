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

/** Providers whose source managers fetch audio. Arbitrary HTTP playback is disabled in Lavalink too. */
const MUSIC_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
  'soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com',
  'open.spotify.com', 'deezer.com', 'www.deezer.com',
  'music.yandex.ru', 'music.yandex.com', 'music.yandex.kz', 'music.yandex.by',
  'bandcamp.com', 'www.bandcamp.com', 'twitch.tv', 'www.twitch.tv', 'vimeo.com', 'www.vimeo.com',
]);

/**
 * Only search text or HTTPS links to known music providers may reach Lavalink. Checking DNS in the bot cannot
 * pin the address Lavalink later connects to or guard its redirects, so generic HTTP sources must remain off.
 */
export function playableQuery(query: string): boolean {
  const value = query.trim();
  if (value.startsWith('//') || value.startsWith('\\\\')) return false;
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return MUSIC_HOSTS.has(url.hostname) || /^[a-z0-9-]+\.bandcamp\.com$/.test(url.hostname);
}
