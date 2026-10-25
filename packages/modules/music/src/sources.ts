import { z } from 'zod';
import { SearchSource } from './config.js';

/**
 * Lavalink source managers a search source needs (GET /v4/info → sourceManagers). A plugin registers its manager
 * only when it is on and starts. Spotify gives no audio: its tracks play from YouTube Music (lavasrc.providers).
 */
export const SOURCE_MANAGERS: Record<SearchSource, readonly string[]> = {
  soundcloud: ['soundcloud'],
  bandcamp: ['bandcamp'],
  youtube: ['youtube'],
  youtubemusic: ['youtube'],
  deezer: ['deezer'],
  spotify: ['spotify', 'youtube'],
  yandexmusic: ['yandexmusic'],
};

/** Search sources a node with these source managers can serve. */
export function supportedSources(sourceManagers: readonly string[]): SearchSource[] {
  return SearchSource.options.filter((s) => SOURCE_MANAGERS[s].every((m) => sourceManagers.includes(m)));
}

/** Searched on every source to see that its credentials work: a source that answers with an error is unavailable. */
export const PROBE_QUERY = 'test';
/** How often the sources are checked again, by one cluster at a time. */
export const PROBE_INTERVAL_MS = 5 * 60_000;
/** Without a fresh check (the bot or Lavalink is down) the list expires and no source is offered. */
export const SOURCES_TTL_SEC = 15 * 60;

/** The dashboard's search sources: available on the audio nodes and answering searches. */
export const SourcesState = z.object({
  sources: z.array(SearchSource),
  /** Epoch ms of the check; null — none yet (music is off or the bot has not reached Lavalink). */
  checkedAt: z.number().int().nullable(),
});
export type SourcesState = z.infer<typeof SourcesState>;
