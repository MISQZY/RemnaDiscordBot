import { z } from 'zod';
import { ModuleId, Snowflake } from './common.js';

/** Inter-process bus messages (Redis pub/sub). */

export const ConfigInvalidation = z.object({
  guildId: Snowflake,
  /** Not set — invalidate all of the guild's modules. */
  moduleId: ModuleId.optional(),
});
export type ConfigInvalidation = z.infer<typeof ConfigInvalidation>;

/** Bot cluster state; clusters refresh it in Redis with a TTL. */
export const ShardHeartbeat = z.object({
  shardId: z.number().int().nonnegative(),
  status: z.enum(['ready', 'connecting', 'reconnecting', 'idle', 'nearly', 'disconnected', 'waitingForGuilds', 'identifying', 'resuming']),
  ping: z.number(),
  guilds: z.number().int().nonnegative(),
  /** Sum of guild member counts, not unique Discord accounts. */
  members: z.number().int().nonnegative(),
});

export const ClusterHeartbeat = z.object({
  clusterId: z.number().int(),
  shards: z.array(z.number().int()),
  guilds: z.number().int(),
  /** Gateway ping in ms; -1 — not measured yet. */
  ping: z.number(),
  ready: z.boolean(),
  updatedAt: z.iso.datetime(),
  /** Optional so API and bot processes can be upgraded independently. */
  totalShards: z.number().int().positive().optional(),
  uptime: z.number().nonnegative().optional(),
  memoryBytes: z.number().int().nonnegative().optional(),
  shardStats: z.array(ShardHeartbeat).optional(),
});
export type ClusterHeartbeat = z.infer<typeof ClusterHeartbeat>;
