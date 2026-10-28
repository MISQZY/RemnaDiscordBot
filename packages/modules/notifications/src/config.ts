import { MessageTemplate, Snowflake } from '@bot/contracts';
import type { NotificationSource, NotificationSubscription } from '@bot/db';
import { z } from 'zod';

/** No guild-level settings yet: everything is set per subscription. */
export const NotificationsConfig = z.object({});
export type NotificationsConfig = z.infer<typeof NotificationsConfig>;

export const MAX_SUBSCRIPTIONS = 25;

export const Provider = z.enum(['youtube', 'twitch', 'feed']);

/** Why a source's last check failed: it is gone, the platform did not answer, or the address serves no readable feed. */
export const SourceError = z.enum(['notFound', 'unavailable', 'invalid']);
export type SourceError = z.infer<typeof SourceError>;

/** Why the last announcement was not posted: no rights in the channel, no channel, or anything else. */
export const DeliveryError = z.enum(['noAccess', 'channelNotFound', 'failed']);
export type DeliveryError = z.infer<typeof DeliveryError>;

export const FILTER_LIMITS = { words: 20, word: 100 } as const;

const FilterWords = z.array(z.string().trim().min(1).max(FILTER_LIMITS.word)).max(FILTER_LIMITS.words);

/** Which items a subscription announces, by words in their title or description; case is ignored. */
export const SubscriptionFilter = z.object({
  /** At least one of them must be there; empty — any item. */
  include: FilterWords.default([]),
  /** None of them may be there. */
  exclude: FilterWords.default([]),
});
export type SubscriptionFilter = z.infer<typeof SubscriptionFilter>;

const NO_FILTER: SubscriptionFilter = { include: [], exclude: [] };

export function matchesFilter(filter: SubscriptionFilter, text: string): boolean {
  const haystack = text.toLocaleLowerCase();
  const has = (word: string) => haystack.includes(word.toLocaleLowerCase());
  return (filter.include.length === 0 || filter.include.some(has)) && !filter.exclude.some(has);
}

/** A stored filter; one that is missing or broken lets everything through. */
export const storedFilter = (value: unknown): SubscriptionFilter => SubscriptionFilter.catch(NO_FILTER).parse(value ?? NO_FILTER);

export const SubscriptionCreate = z.object({
  provider: Provider,
  /** Channel link, ID or name (`@handle` for YouTube, login for Twitch); a feed's or a site's link. */
  query: z.string().min(1).max(500),
  channelId: Snowflake,
  mentionRoleId: Snowflake.nullable().default(null),
  message: MessageTemplate.optional(),
  filter: SubscriptionFilter.optional(),
});
export type SubscriptionCreate = z.infer<typeof SubscriptionCreate>;

export const SubscriptionUpdate = z
  .object({
    channelId: Snowflake,
    mentionRoleId: Snowflake.nullable(),
    message: MessageTemplate,
    filter: SubscriptionFilter,
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
  filter: SubscriptionFilter,
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
    filter: storedFilter(row.filter),
    enabled: row.enabled,
    delivery: {
      at: iso(row.deliveredAt),
      error: row.deliveryError === null ? null : DeliveryError.catch('failed').parse(row.deliveryError),
    },
    createdAt: row.createdAt.toISOString(),
  };
}
