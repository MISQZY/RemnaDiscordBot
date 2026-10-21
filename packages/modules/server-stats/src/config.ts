import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

/** What a counter's name may show. */
export const STAT_PLACEHOLDERS = ['members', 'online', 'boosts', 'boostTier', 'channels', 'roles'] as const;

export const Counter = z.object({
  /** A channel whose name the bot keeps up to date — usually a locked voice channel. */
  channelId: Snowflake,
  /** `Участников: {members}`; see STAT_PLACEHOLDERS. */
  template: z.string().trim().min(1).max(100),
});
export type Counter = z.infer<typeof Counter>;

export const ServerStatsConfig = z.object({
  counters: z
    .array(Counter)
    .max(10)
    .refine((list) => new Set(list.map((c) => c.channelId)).size === list.length, { message: 'Each channel only once' }),
});
export type ServerStatsConfig = z.infer<typeof ServerStatsConfig>;

export const defaultServerStatsConfig: ServerStatsConfig = { counters: [] };
