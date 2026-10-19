import { MessageTemplate, Snowflake } from '@bot/contracts';
import type { NotificationSource, NotificationSubscription } from '@bot/db';
import { z } from 'zod';

/** Настроек уровня гильдии пока нет: всё задаётся в подписках. */
export const NotificationsConfig = z.object({});
export type NotificationsConfig = z.infer<typeof NotificationsConfig>;

export const MAX_SUBSCRIPTIONS = 25;

export const Provider = z.enum(['youtube', 'twitch']);

export const SubscriptionCreate = z.object({
  provider: Provider,
  /** Ссылка на канал, ID или имя (`@handle` для YouTube, логин для Twitch). */
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
  source: z.object({ externalId: z.string(), name: z.string() }),
  channelId: Snowflake,
  mentionRoleId: Snowflake.nullable(),
  message: MessageTemplate,
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionDto>;

export function toDto(row: NotificationSubscription & { source: NotificationSource }): SubscriptionDto {
  return {
    id: row.id,
    provider: Provider.parse(row.source.provider),
    source: { externalId: row.source.externalId, name: row.source.name },
    channelId: row.channelId,
    mentionRoleId: row.mentionRoleId,
    message: MessageTemplate.parse(row.message),
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}
