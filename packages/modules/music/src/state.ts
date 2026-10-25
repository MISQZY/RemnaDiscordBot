import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const MusicKeys = {
  /** What the guild's player is doing — for the dashboard; written by the cluster that owns the player. */
  state: (guildId: string) => `music:state:${guildId}`,
  /** A player saved on shutdown and picked up by whichever cluster owns the guild after the restart. */
  resume: (guildId: string) => `music:resume:${guildId}`,
  resumePattern: 'music:resume:*',
  /** Dashboard → bot: player actions, executed by the cluster that has the player. */
  control: 'music:control',
  /** Search sources that work (SourcesState of sources.ts), checked by the bot. */
  sources: 'music:sources',
  /** Held by the cluster checking the sources, so the others skip that round. */
  sourcesLock: 'music:sources:lock',
} as const;

export const STATE_TTL_SEC = 3600;
export const RESUME_TTL_SEC = 600;

export const TrackView = z.object({
  title: z.string(),
  author: z.string(),
  uri: z.string().nullable(),
  artworkUrl: z.string().nullable(),
  durationMs: z.number().int(),
  isStream: z.boolean(),
  requesterId: Snowflake.nullable(),
});
export type TrackView = z.infer<typeof TrackView>;

export const PlayerState = z.object({
  voiceChannelId: Snowflake.nullable(),
  textChannelId: Snowflake.nullable(),
  current: TrackView.nullable(),
  /** Position at `updatedAt`; while playing it moves on in real time. */
  positionMs: z.number().int(),
  paused: z.boolean(),
  volume: z.number().int(),
  repeatMode: z.enum(['off', 'track', 'queue']),
  queue: z.array(TrackView),
  queueSize: z.number().int(),
  updatedAt: z.number().int(),
});
export type PlayerState = z.infer<typeof PlayerState>;

export const ControlAction = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['pause', 'resume', 'skip', 'stop', 'shuffle', 'previous']) }),
  z.object({ action: z.literal('volume'), value: z.number().int().min(0).max(150) }),
  z.object({ action: z.literal('repeat'), value: z.enum(['off', 'track', 'queue']) }),
  z.object({ action: z.literal('seek'), value: z.number().int().min(0) }),
  z.object({ action: z.literal('remove'), value: z.number().int().min(1) }),
]);
export type ControlAction = z.infer<typeof ControlAction>;

export const ControlMessage = z.object({ guildId: Snowflake, userId: Snowflake }).and(ControlAction);
export type ControlMessage = z.infer<typeof ControlMessage>;

/** Tracks of the queue preview in the state; the rest only counts toward `queueSize`. */
export const STATE_QUEUE_PREVIEW = 25;
