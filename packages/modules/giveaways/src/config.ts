import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const GiveawaysConfig = z.object({
  /** Besides those with Manage Server, these roles start and end giveaways with /giveaway. */
  managerRoleIds: z.array(Snowflake).max(10),
  /** Tell the winners in DMs too. */
  dmWinners: z.boolean(),
  /** The giveaway message's colour. */
  color: z.number().int().min(0).max(0xffffff),
});
export type GiveawaysConfig = z.infer<typeof GiveawaysConfig>;

export const defaultGiveawaysConfig: GiveawaysConfig = { managerRoleIds: [], dmWinners: true, color: 0xf47fff };

/** A giveaway lasts from a minute to two months. */
export const MAX_DURATION_SEC = 60 * 86_400;

export const GiveawayInput = z.object({
  channelId: Snowflake,
  prize: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable(),
  winners: z.number().int().min(1).max(50),
  endsAt: z.iso.datetime({ offset: true }),
  requiredRoleIds: z.array(Snowflake).max(5),
  minMemberDays: z.number().int().min(0).max(365),
});
export type GiveawayInput = z.infer<typeof GiveawayInput>;

export const GiveawayDto = GiveawayInput.extend({
  id: z.string(),
  messageId: Snowflake.nullable(),
  endsAt: z.iso.datetime(),
  hostId: z.string(),
  status: z.enum(['running', 'ended', 'cancelled']),
  winnerIds: z.array(Snowflake),
  entries: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type GiveawayDto = z.infer<typeof GiveawayDto>;
