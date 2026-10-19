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
export const ClusterHeartbeat = z.object({
  clusterId: z.number().int(),
  shards: z.array(z.number().int()),
  guilds: z.number().int(),
  /** Gateway ping in ms; -1 — not measured yet. */
  ping: z.number(),
  ready: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ClusterHeartbeat = z.infer<typeof ClusterHeartbeat>;
