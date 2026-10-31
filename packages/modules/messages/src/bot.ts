import type { BotModuleContext } from '@bot/core';
import type { Message } from 'discord.js';
import type { MessagesConfig } from './config.js';
import { MessageService, stickyKey } from './service.js';

/** One timer per channel: the sticky message is posted again once the channel is quiet. */
const timers = new Map<string, NodeJS.Timeout>();

const STICKY_CACHE_TTL_MS = 30_000;
const STICKY_CACHE_MAX_SIZE = 5_000;

interface CacheEntry {
  exists: boolean;
  expiresAt: number;
}

const stickyCache = new Map<string, CacheEntry>();

async function hasSticky(ctx: BotModuleContext<MessagesConfig>, channelId: string): Promise<boolean> {
  const now = Date.now();
  const cached = stickyCache.get(channelId);
  if (cached && cached.expiresAt > now) {
    return cached.exists;
  }

  const exists = (await ctx.redis.exists(stickyKey(channelId))) === 1;

  if (stickyCache.size >= STICKY_CACHE_MAX_SIZE) {
    for (const [key, entry] of stickyCache.entries()) {
      if (entry.expiresAt <= now) {
        stickyCache.delete(key);
      }
    }
    if (stickyCache.size >= STICKY_CACHE_MAX_SIZE) {
      const firstKey = stickyCache.keys().next().value;
      if (firstKey) stickyCache.delete(firstKey);
    }
  }

  stickyCache.set(channelId, { exists, expiresAt: now + STICKY_CACHE_TTL_MS });
  return exists;
}

export async function onMessage(ctx: BotModuleContext<MessagesConfig>, message: Message): Promise<void> {
  if (!message.inGuild() || message.author.id === ctx.client.user?.id) return;
  if (!(await hasSticky(ctx, message.channelId))) return;
  const config = await ctx.getConfig(message.guildId);

  clearTimeout(timers.get(message.channelId));
  const timer = setTimeout(() => {
    timers.delete(message.channelId);
    new MessageService(ctx).repost(message.channelId).catch((err: unknown) => ctx.logger.warn({ err, channelId: message.channelId }, 'Sticky message not reposted'));
  }, config.stickyDelaySec * 1000);
  timer.unref();
  timers.set(message.channelId, timer);
}

/** Timers do not outlive the cluster. */
export function clearStickyTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  stickyCache.clear();
}
