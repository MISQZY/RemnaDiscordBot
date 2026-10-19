import { z } from 'zod';
import { ModuleId, Snowflake } from './common.js';

/** Сообщения межпроцессной шины (Redis pub/sub). */

export const ConfigInvalidation = z.object({
  guildId: Snowflake,
  /** Не указан — сбросить все модули гильдии. */
  moduleId: ModuleId.optional(),
});
export type ConfigInvalidation = z.infer<typeof ConfigInvalidation>;
