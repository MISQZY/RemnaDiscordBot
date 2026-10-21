import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const InviteReward = z.object({ invites: z.number().int().min(1).max(10_000), roleId: Snowflake });

export const InvitesConfig = z.object({
  /** "X joined, invited by Y" for each join; `null` — no log. */
  logChannelId: Snowflake.nullable(),
  /** Those who left are taken off the inviter's count. */
  countLeaves: z.boolean(),
  /** Accounts younger than this are not counted (fake); 0 — all count. */
  fakeAccountDays: z.number().int().min(0).max(365),
  /** Roles for the inviter at a number of invites. */
  rewards: z
    .array(InviteReward)
    .max(25)
    .refine((list) => new Set(list.map((r) => r.invites)).size === list.length, { message: 'One role per number of invites' }),
});
export type InvitesConfig = z.infer<typeof InvitesConfig>;

export const defaultInvitesConfig: InvitesConfig = { logChannelId: null, countLeaves: true, fakeAccountDays: 0, rewards: [] };

export const InviteCounts = z.object({
  userId: Snowflake,
  /** Everyone who came by their invites. */
  joins: z.number().int(),
  left: z.number().int(),
  fake: z.number().int(),
  /** What counts: joins less fakes, and less those who left when the server counts leaves. */
  total: z.number().int(),
});
export type InviteCounts = z.infer<typeof InviteCounts>;
