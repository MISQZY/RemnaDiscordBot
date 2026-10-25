import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

/** Search providers for plain-text queries; links are played from wherever Lavalink can load them. */
export const SearchSource = z.enum(['soundcloud', 'bandcamp', 'youtube', 'youtubemusic', 'deezer', 'spotify', 'yandexmusic']);
export type SearchSource = z.infer<typeof SearchSource>;

export const AnnounceTarget = z.enum(['command', 'voice', 'channel']);
export type AnnounceTarget = z.infer<typeof AnnounceTarget>;

export const MusicConfig = z.object({
  /** Members with these roles control the player (skip, stop, volume…); empty — everyone. */
  djRoleIds: z.array(Snowflake).max(25),
  /** Voice channels the bot may play in; empty — any. */
  allowedVoiceChannelIds: z.array(Snowflake).max(50),
  searchSource: SearchSource,
  defaultVolume: z.number().int().min(1).max(150),
  /** Tracks waiting in the queue, the current one excluded. */
  maxQueueSize: z.number().int().min(1).max(1000),
  /** Longer tracks are not queued; 0 — no limit. Streams are always allowed. */
  maxTrackDurationSec: z.number().int().min(0).max(24 * 3600),
  /** Leave the voice channel after it stays without listeners this long; 0 — stay. */
  leaveWhenAloneSec: z.number().int().min(0).max(3600),
  /** Post a "now playing" message with player buttons. */
  announceTracks: z.boolean(),
  /**
   * Where that message goes: `command` — the channel `/play` was used in, `voice` — the chat of the voice channel the
   * bot plays in, `channel` — `announceChannelId`. Configs from before the choice have none: the command's channel.
   */
  announceTarget: AnnounceTarget.default('command'),
  announceChannelId: Snowflake.nullable().default(null),
});
export type MusicConfig = z.infer<typeof MusicConfig>;

export const defaultMusicConfig: MusicConfig = {
  djRoleIds: [],
  allowedVoiceChannelIds: [],
  searchSource: 'soundcloud',
  defaultVolume: 80,
  maxQueueSize: 200,
  maxTrackDurationSec: 0,
  leaveWhenAloneSec: 60,
  announceTracks: true,
  announceTarget: 'command',
  announceChannelId: null,
};
