import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Locale } from '@bot/contracts';
import { HttpError, type ModuleServices } from '@bot/core';
import { DiscordAPIError, RESTJSONErrorCodes, Routes, type APIThreadChannel } from 'discord.js';
import type { NotificationsConfig } from './config.js';

/** Serialize creation across scheduled checks, manual sends and incoming webhooks. */
export async function postToSubscriptionThread(
  ctx: ModuleServices<NotificationsConfig>, subscriptionId: string, body: object, locale: Locale,
): Promise<void> {
  const key = `lock:notifications:thread:${subscriptionId}`;
  const owner = randomUUID();
  const deadline = Date.now() + 15_000;
  while (!(await ctx.redis.set(key, owner, 'PX', 30_000, 'NX'))) {
    if (Date.now() >= deadline) throw HttpError.conflict('Subscription delivery is already in progress');
    await delay(50);
  }
  const owned = () => ctx.redis.get(key).then((value) => value === owner);
  const renew = setInterval(() => {
    void ctx.redis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], 30000) end return 0',
      1, key, owner,
    ).catch((err: unknown) => ctx.logger.warn({ err, subscriptionId }, 'Thread delivery lock renewal failed'));
  }, 10_000);
  renew.unref();
  try {
    const row = await ctx.db.notificationSubscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { source: true } });
    // A destination may have changed while this delivery was waiting for the lock.
    if (row.deliveryMode !== 'thread') {
      await ctx.rest.post(Routes.channelMessages(row.channelId), { body });
      return;
    }
    let threadId = row.threadId;
    if (threadId) {
      try {
        const thread = await ctx.rest.get(Routes.channel(threadId)) as APIThreadChannel;
        if (thread.guild_id !== row.guildId || thread.parent_id !== row.channelId) throw HttpError.forbidden('Subscription thread is outside its configured channel');
        if (thread.thread_metadata?.locked) throw HttpError.forbidden('Subscription thread is locked');
        if (thread.thread_metadata?.archived) await ctx.rest.patch(Routes.channel(threadId), { body: { archived: false } });
      } catch (err) {
        if (!(err instanceof DiscordAPIError) || err.code !== RESTJSONErrorCodes.UnknownChannel) throw err;
        threadId = null;
      }
    }
    if (!threadId) {
      const name = row.source.name.replace(/\s+/g, ' ').trim().slice(0, 100) || ctx.i18n.t(locale, 'notifications.thread.name');
      const starter = await ctx.rest.post(Routes.channelMessages(row.channelId), {
        body: {
          content: ctx.i18n.t(locale, 'notifications.thread.started', { name }),
          allowed_mentions: { parse: [] },
        },
      }) as { id: string };
      let created: { id: string };
      try {
        created = await ctx.rest.post(Routes.threads(row.channelId, starter.id), {
          body: { name, auto_archive_duration: 1440 },
        }) as { id: string };
      } catch (err) {
        await ctx.rest.delete(Routes.channelMessage(row.channelId, starter.id)).catch(() => undefined);
        throw err;
      }
      // Do not retain a thread created for settings that changed during the Discord requests.
      const saved = await owned() && await ctx.db.notificationSubscription.updateMany({
        where: { id: row.id, channelId: row.channelId, deliveryMode: 'thread', threadId: row.threadId },
        data: { threadId: created.id },
      });
      if (!saved || saved.count !== 1) {
        await ctx.rest.delete(Routes.channel(created.id)).catch(() => undefined);
        throw HttpError.conflict('Subscription destination changed during thread creation');
      }
      threadId = created.id;
    }
    if (!(await owned())) throw HttpError.conflict('Subscription delivery lock expired');
    const destination = await ctx.db.notificationSubscription.findUnique({
      where: { id: row.id }, select: { channelId: true, deliveryMode: true, threadId: true },
    });
    if (!destination || destination.channelId !== row.channelId || destination.deliveryMode !== 'thread' || destination.threadId !== threadId) {
      throw HttpError.conflict('Subscription destination changed during delivery');
    }
    await ctx.rest.post(Routes.channelMessages(threadId), { body });
  } finally {
    clearInterval(renew);
    await ctx.redis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0',
      1, key, owner,
    );
  }
}
