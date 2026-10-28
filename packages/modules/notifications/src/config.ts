import { MessageTemplate, Snowflake } from '@bot/contracts';
import type { NotificationSource, NotificationSubscription } from '@bot/db';
import { z } from 'zod';

/** No guild-level settings yet: everything is set per subscription. */
export const NotificationsConfig = z.object({});
export type NotificationsConfig = z.infer<typeof NotificationsConfig>;

export const MAX_SUBSCRIPTIONS = 25;

export const Provider = z.enum(['youtube', 'twitch']);

/** Why a source's last check failed: it is gone, or the platform did not answer. */
export const SourceError = z.enum(['notFound', 'unavailable']);
export type SourceError = z.infer<typeof SourceError>;

/** Why the last announcement was not posted: no rights in the channel, no channel, or anything else. */
export const DeliveryError = z.enum(['noAccess', 'channelNotFound', 'failed']);
export type DeliveryError = z.infer<typeof DeliveryError>;

export const SubscriptionCreate = z.object({
  provider: Provider,
  /** Channel link, ID or name (`@handle` for YouTube, login for Twitch). */
  query: z.string().min(1).max(200),
  channelId: Snowflake,
  mentionRoleId: Snowflake.nullable().default(null),
  message: MessageTemplate.optional(),
});
export type SubscriptionCreate = z.infer<typeof SubscriptionCreate>;

export const SubscriptionUpdate = z
  .object({
    channelId: Snowflake,
    mentionRoleId: Snowflake.nullable(),
    message: MessageTemplate,
    enabled: z.boolean(),
  })
  .partial();
export type SubscriptionUpdate = z.infer<typeof SubscriptionUpdate>;

export const SubscriptionDto = z.object({
  id: z.string(),
  provider: Provider,
  source: z.object({
    externalId: z.string(),
    name: z.string(),
    /** The last successful check; null until the first one. */
    checkedAt: z.iso.datetime().nullable(),
    /** Why checks are failing now; null when the last one succeeded. */
    error: SourceError.nullable(),
  }),
  channelId: Snowflake,
  mentionRoleId: Snowflake.nullable(),
  message: MessageTemplate,
  enabled: z.boolean(),
  /** The last announcement: when it was posted, or why it was not. */
  delivery: z.object({ at: z.iso.datetime().nullable(), error: DeliveryError.nullable() }),
  createdAt: z.iso.datetime(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionDto>;

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function toDto(row: NotificationSubscription & { source: NotificationSource }): SubscriptionDto {
  const { source } = row;
  return {
    id: row.id,
    provider: Provider.parse(source.provider),
    source: {
      externalId: source.externalId,
      name: source.name,
      checkedAt: iso(source.lastSuccessAt),
      // An unknown stored reason still reads as a failure.
      error: source.lastError === null ? null : SourceError.catch('unavailable').parse(source.lastError),
    },
    channelId: row.channelId,
    mentionRoleId: row.mentionRoleId,
    message: MessageTemplate.parse(row.message),
    enabled: row.enabled,
    delivery: {
      at: iso(row.deliveredAt),
      error: row.deliveryError === null ? null : DeliveryError.catch('failed').parse(row.deliveryError),
    },
    createdAt: row.createdAt.toISOString(),
  };
}
