import { MessageTemplate, Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const MessagesConfig = z.object({
  /** Members may set reminders with /remind. */
  reminders: z.boolean(),
  maxRemindersPerUser: z.number().int().min(1).max(25),
  /** A sticky message is posted again once the channel is quiet this long. */
  stickyDelaySec: z.number().int().min(2).max(60),
});
export type MessagesConfig = z.infer<typeof MessagesConfig>;

export const defaultMessagesConfig: MessagesConfig = { reminders: true, maxRemindersPerUser: 10, stickyDelaySec: 5 };

export const SendInput = z.object({ channelId: Snowflake, message: MessageTemplate });
export type SendInput = z.infer<typeof SendInput>;

export const SentMessage = z.object({
  id: z.string(),
  channelId: Snowflake,
  messageId: Snowflake,
  message: MessageTemplate,
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SentMessage = z.infer<typeof SentMessage>;

/** Repeats from ten minutes to a month. */
export const MAX_INTERVAL_MIN = 31 * 24 * 60;

export const ScheduledInput = z.object({
  channelId: Snowflake,
  message: MessageTemplate,
  nextRunAt: z.iso.datetime({ offset: true }),
  /** 0 — once. */
  intervalMin: z.union([z.literal(0), z.number().int().min(10).max(MAX_INTERVAL_MIN)]),
  enabled: z.boolean(),
});
export type ScheduledInput = z.infer<typeof ScheduledInput>;

export const ScheduledDto = ScheduledInput.extend({
  id: z.string(),
  nextRunAt: z.iso.datetime(),
  lastRunAt: z.iso.datetime().nullable(),
  createdBy: z.string(),
});
export type ScheduledDto = z.infer<typeof ScheduledDto>;

export const StickyInput = z.object({ message: MessageTemplate, enabled: z.boolean() });
export type StickyInput = z.infer<typeof StickyInput>;

export const StickyDto = StickyInput.extend({ channelId: Snowflake, lastMessageId: Snowflake.nullable(), updatedAt: z.iso.datetime() });
export type StickyDto = z.infer<typeof StickyDto>;

export const MAX_SCHEDULED = 25;
export const MAX_STICKY = 25;
