import { z } from 'zod';
import { ModuleId, Snowflake } from './common.js';

/** Сообщения межпроцессной шины (Redis pub/sub). */

export const ConfigInvalidation = z.object({
  guildId: Snowflake,
  /** Не указан — сбросить все модули гильдии. */
  moduleId: ModuleId.optional(),
});
export type ConfigInvalidation = z.infer<typeof ConfigInvalidation>;

/** Состояние кластера бота; кластеры обновляют его в Redis с TTL. */
export const ClusterHeartbeat = z.object({
  clusterId: z.number().int(),
  shards: z.array(z.number().int()),
  guilds: z.number().int(),
  /** Пинг gateway в мс; -1 — ещё не измерен. */
  ping: z.number(),
  ready: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ClusterHeartbeat = z.infer<typeof ClusterHeartbeat>;
