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
