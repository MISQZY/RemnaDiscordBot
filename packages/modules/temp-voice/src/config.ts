import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const Creator = z.object({
  /** The voice channel to join to get your own. */
  channelId: Snowflake,
  /** Where the new channels go; `null` — the creator's category. */
  categoryId: Snowflake.nullable(),
  /** Placeholders: `{user.displayName}`, `{user.name}`, `{count}` — the number of the channel. */
  nameTemplate: z.string().trim().min(1).max(100),
  /** 0 — no limit. */
  userLimit: z.number().int().min(0).max(99),
});
export type Creator = z.infer<typeof Creator>;

export const TempVoiceConfig = z.object({
  creators: z
    .array(Creator)
    .max(10)
    .refine((list) => new Set(list.map((c) => c.channelId)).size === list.length, { message: 'Each creator channel only once' }),
  /** Buttons for the owner in the channel's chat: lock, hide, limit, rename, kick, give away. */
  controlPanel: z.boolean(),
});
export type TempVoiceConfig = z.infer<typeof TempVoiceConfig>;

export const defaultTempVoiceConfig: TempVoiceConfig = { creators: [], controlPanel: true };

export const ACTIONS = ['lock', 'unlock', 'hide', 'unhide', 'limit', 'rename', 'kick', 'transfer', 'claim'] as const;
export type Action = (typeof ACTIONS)[number];
