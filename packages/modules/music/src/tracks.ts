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

export interface CleanQueryOptions {
  /** When false (default), strips playlist parameters from track URLs (e.g. YouTube watch?v=...&list=...). */
  allowPlaylist?: boolean;
}

/**
 * Normalizes user queries before passing them to Lavalink.
 * Strips tracking parameters, and removes unwanted playlist parameters from track links (such as YouTube
 * auto-generated Mixes `&list=RD...` which load 25 tracks by default, or regular playlists when `allowPlaylist` is false).
 */
export function cleanMusicQuery(query: string, options: CleanQueryOptions = {}): string {
  const value = query.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  const hostname = url.hostname.toLowerCase();

  // YouTube / YouTube Music
  if (
    hostname === 'youtube.com' ||
    hostname === 'www.youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'music.youtube.com' ||
    hostname === 'youtu.be'
  ) {
    const isYoutuBe = hostname === 'youtu.be';
    const isWatch = url.pathname === '/watch';
    const isShorts = url.pathname.startsWith('/shorts/');
    const hasVideo = (isWatch && url.searchParams.has('v')) || isYoutuBe || isShorts;
    const list = url.searchParams.get('list');

    // Remove tracking/irrelevant params
    for (const param of ['si', 'feature', 'start_radio', 'pp', 'utm_source', 'utm_medium', 'utm_campaign']) {
      url.searchParams.delete(param);
    }

    if (hasVideo && list) {
      // YouTube Mix / Radio (RD..., RDAMVM..., RDMM..., RDCLAK..., UL...) is an auto-generated playlist.
      // Standard playlists (PL...) are stripped unless explicitly allowed.
      const isMix = /^RD|^UL/i.test(list);
      if (isMix || !options.allowPlaylist) {
        url.searchParams.delete('list');
      }
      url.searchParams.delete('index');
    }

    return url.toString();
  }

  // SoundCloud
  if (hostname === 'soundcloud.com' || hostname === 'www.soundcloud.com' || hostname === 'm.soundcloud.com') {
    if (!options.allowPlaylist && url.searchParams.has('in')) {
      url.searchParams.delete('in');
      return url.toString();
    }
  }

  // Spotify
  if (hostname === 'open.spotify.com') {
    url.searchParams.delete('si');
    return url.toString();
  }

  return value;
}

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
