import { MessageTemplate } from '@bot/contracts';
import type { ModuleServices } from '@bot/core';
import type { NotificationSubscription } from '@bot/db';
import { renderMessage, toRestMessage } from '@bot/templates';
import { DiscordAPIError, RESTJSONErrorCodes, Routes } from 'discord.js';
import { matchesFilter, storedFilter, type DeliveryError, type NotificationsConfig } from './config.js';
import { SourceFailure, type FeedItem, type FeedResult, type Provider } from './providers.js';

/** Announcement body; only the subscription's role is pinged, not any role from the template. */
export function announcementBody(
  subscription: { message: unknown; mentionRoleId: string | null },
  vars: Record<string, string | number>,
) {
  const { content, embeds, allowed_mentions } = toRestMessage(renderMessage(MessageTemplate.parse(subscription.message), vars));
  const role = subscription.mentionRoleId;
  return {
    content: role ? `<@&${role}> ${content ?? ''}`.trim() : content,
    embeds,
    allowed_mentions: {
      parse: allowed_mentions.parse.filter((p) => p !== 'roles'),
      ...(role ? { roles: [role] } : {}),
    },
  };
}

/** How many new items to announce per check — protects against a flood after downtime. */
const MAX_ITEMS_PER_CHECK = 3;
/** How many item IDs a source remembers beyond those in its current feed. */
const SEEN_LIMIT = 100;
/** A source failing again and again is checked less often: from 5 minutes up to 6 hours between checks. */
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;

/** How long to put a source off after `failures` failed checks in a row; a single failure is retried as usual. */
export function backoffMs(failures: number): number {
  return failures < 2 ? 0 : Math.min(BACKOFF_BASE_MS * 2 ** (failures - 2), BACKOFF_MAX_MS);
}

/**
 * The items to announce, oldest first: the unseen ones above the first item already seen. Not just "unseen":
 * when a video is deleted, an older one the feed had cut off comes back into it and must not be announced.
 * Before the first check nothing is announced.
 */
export function freshItems(items: FeedItem[], seenIds: readonly string[] | null): FeedItem[] {
  if (seenIds === null) return [];
  const seen = new Set(seenIds);
  const firstSeen = items.findIndex((item) => seen.has(item.id));
  return (firstSeen === -1 ? items : items.slice(0, firstSeen)).slice(0, MAX_ITEMS_PER_CHECK).reverse();
}

/** The IDs to remember: the current feed's, then the earlier ones it no longer has. */
export function rememberItems(items: FeedItem[], seenIds: readonly string[] | null): string[] {
  const current = items.map((item) => item.id);
  const kept = (seenIds ?? []).filter((id) => !current.includes(id));
  return [...current, ...kept].slice(0, Math.max(SEEN_LIMIT, current.length));
}

const asIds = (value: unknown): string[] | null => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : null);

function deliveryError(err: unknown): DeliveryError {
  if (!(err instanceof DiscordAPIError)) return 'failed';
  if (err.code === RESTJSONErrorCodes.UnknownChannel) return 'channelNotFound';
  if (err.code === RESTJSONErrorCodes.MissingAccess || err.code === RESTJSONErrorCodes.MissingPermissions) return 'noAccess';
  return 'failed';
}

type Deliverable = Pick<NotificationSubscription, 'id' | 'guildId' | 'channelId' | 'mentionRoleId' | 'message' | 'filter'>;

/**
 * Announces an item to a subscription and records how it went: `posted`, `skipped` (the filter or the module said
 * no), or why Discord refused it.
 */
export async function deliver(ctx: ModuleServices<NotificationsConfig>, subscription: Deliverable, item: FeedItem): Promise<'posted' | 'skipped' | DeliveryError> {
  if (!matchesFilter(storedFilter(subscription.filter), item.text ?? '')) return 'skipped';
  if (!(await ctx.config.isEnabled(subscription.guildId, 'notifications'))) return 'skipped';
  let error: DeliveryError | null = null;
  try {
    await ctx.rest.post(Routes.channelMessages(subscription.channelId), { body: announcementBody(subscription, item.vars) });
  } catch (err) {
    error = deliveryError(err);
    ctx.logger.warn({ err, subscriptionId: subscription.id }, 'Notification not delivered');
  }
  await ctx.db.notificationSubscription.update({
    where: { id: subscription.id },
    data: error ? { deliveryError: error } : { deliveredAt: new Date(), deliveryError: null },
  });
  return error ?? 'posted';
}

/**
 * Checks the provider's due sources that have enabled subscriptions and sends announcements.
 * Every check is recorded on the source: when it succeeded, or why it failed.
 */
export async function pollProvider(ctx: ModuleServices<NotificationsConfig>, provider: Provider): Promise<number> {
  const now = new Date();
  const sources = await ctx.db.notificationSource.findMany({
    where: {
      provider: provider.id,
      subscriptions: { some: { enabled: true } },
      OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
    },
    include: { subscriptions: { where: { enabled: true } } },
  });
  if (sources.length === 0) return 0;

  let results: Map<string, FeedResult>;
  try {
    results = await provider.latest(sources.map((s) => s.externalId));
  } catch (err) {
    const failure = new SourceFailure('unavailable', err instanceof Error ? err.message : String(err));
    results = new Map(sources.map((s) => [s.externalId, failure]));
  }
  let announced = 0;

  for (const source of sources) {
    const result = results.get(source.externalId) ?? new SourceFailure('unavailable', 'No result from the provider');
    if (result instanceof SourceFailure) {
      const failures = source.failures + 1;
      ctx.logger.warn({ sourceId: source.id, provider: provider.id, kind: result.kind, failures, err: result.message }, 'Notification source check failed');
      await ctx.db.notificationSource.update({
        where: { id: source.id },
        data: { lastCheckedAt: now, lastError: result.kind, failures, nextCheckAt: new Date(now.getTime() + backoffMs(failures)) },
      });
      continue;
    }

    const seenIds = asIds(source.seenIds);
    for (const item of freshItems(result, seenIds)) {
      for (const subscription of source.subscriptions) {
        if ((await deliver(ctx, subscription, item)) === 'posted') announced++;
      }
    }

    await ctx.db.notificationSource.update({
      where: { id: source.id },
      data: {
        seenIds: rememberItems(result, seenIds),
        lastCheckedAt: now,
        lastSuccessAt: now,
        lastError: null,
        failures: 0,
        nextCheckAt: null,
      },
    });
  }
  return announced;
}
