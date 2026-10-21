import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const StarboardConfig = z.object({
  /** Where starred messages are copied; `null` — the starboard is off. */
  channelId: Snowflake.nullable(),
  /** A Unicode emoji or a custom `<:name:id>`. */
  emoji: z.string().trim().min(1).max(64),
  /** Reactions a message needs to get on the board; it leaves the board below it. */
  threshold: z.number().int().min(1).max(100),
  /** The author's own reaction counts. */
  selfStar: z.boolean(),
  ignoredChannelIds: z.array(Snowflake).max(50),
  /** Messages of age-restricted channels may go to the board. */
  allowNsfw: z.boolean(),
});
export type StarboardConfig = z.infer<typeof StarboardConfig>;

export const defaultStarboardConfig: StarboardConfig = { channelId: null, emoji: '⭐', threshold: 3, selfStar: false, ignoredChannelIds: [], allowNsfw: false };

export const StarboardEntryDto = z.object({
  messageId: Snowflake,
  channelId: Snowflake,
  authorId: Snowflake,
  starboardMessageId: Snowflake.nullable(),
  stars: z.number().int(),
  createdAt: z.iso.datetime(),
});
