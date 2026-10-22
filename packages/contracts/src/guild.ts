import { z } from 'zod';
import { Snowflake } from './common.js';

/** Guild snapshots the bot puts into Redis and the API serves to the web app. */

export const GuildMeta = z.object({
  id: Snowflake,
  name: z.string(),
  icon: z.string().nullable(),
  ownerId: Snowflake,
  memberCount: z.number().int(),
  shardId: z.number().int(),
});
export type GuildMeta = z.infer<typeof GuildMeta>;

export const GuildChannel = z.object({
  id: Snowflake,
  name: z.string(),
  /** discord.js ChannelType */
  type: z.number().int(),
  parentId: Snowflake.nullable(),
  position: z.number().int(),
});
export type GuildChannel = z.infer<typeof GuildChannel>;

export const GuildRole = z.object({
  id: Snowflake,
  name: z.string(),
  color: z.number().int(),
  position: z.number().int(),
  managed: z.boolean(),
  /** The bot may assign the role: below the bot's role, not managed, not @everyone and not `elevated`. */
  manageable: z.boolean(),
  /** The role carries moderator permissions — the bot never hands it out. Missing in snapshots written before it. */
  elevated: z.boolean().optional(),
});
export type GuildRole = z.infer<typeof GuildRole>;

export const GuildEmoji = z.object({
  id: Snowflake,
  name: z.string().nullable(),
  animated: z.boolean(),
});
export type GuildEmoji = z.infer<typeof GuildEmoji>;
