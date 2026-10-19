import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const LogCategory = z.enum(['messages', 'members', 'voice', 'server', 'moderation']);
export type LogCategory = z.infer<typeof LogCategory>;

export const AuditLogConfig = z.object({
  /** Канал для каждой категории; `null` — категория не логируется. */
  channels: z.object({
    messages: Snowflake.nullable(),
    members: Snowflake.nullable(),
    voice: Snowflake.nullable(),
    server: Snowflake.nullable(),
    moderation: Snowflake.nullable(),
  }),
  ignoredChannelIds: z.array(Snowflake).max(100),
  ignoredRoleIds: z.array(Snowflake).max(50),
  ignoreBots: z.boolean(),
});
export type AuditLogConfig = z.infer<typeof AuditLogConfig>;

export const defaultAuditLogConfig: AuditLogConfig = {
  channels: { messages: null, members: null, voice: null, server: null, moderation: null },
  ignoredChannelIds: [],
  ignoredRoleIds: [],
  ignoreBots: true,
};
