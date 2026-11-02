import type { BotModuleContext } from '@bot/core';
import type { Message } from 'discord.js';
import type { MessagesConfig } from './config.js';
import { MessageService, stickyKey } from './service.js';

/** One timer per channel: the sticky message is posted again once the channel is quiet. */
const timers = new Map<string, { timer: NodeJS.Timeout; delayMs: number }>();
const loading = new Map<string, Promise<boolean>>();
let generation = 0;

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

  const pending = loading.get(channelId);
  if (pending) return pending;
  const started = generation;
  const work = readSticky(ctx, channelId, now, started).finally(() => {
    if (loading.get(channelId) === work) loading.delete(channelId);
  });
  loading.set(channelId, work);
  return work;
}

async function readSticky(ctx: BotModuleContext<MessagesConfig>, channelId: string, now: number, started: number): Promise<boolean> {
  const exists = (await ctx.redis.exists(stickyKey(channelId))) === 1;
  if (started !== generation) return exists;

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
  const started = generation;
  if (!(await hasSticky(ctx, message.channelId))) return;
  if (started !== generation) return;
  const config = await ctx.getConfig(message.guildId);
  if (started !== generation) return;

  const delayMs = config.stickyDelaySec * 1000;
  const current = timers.get(message.channelId);
  if (current?.delayMs === delayMs) { current.timer.refresh(); return; }
  if (current) clearTimeout(current.timer);
  const timer = setTimeout(() => {
    timers.delete(message.channelId);
    new MessageService(ctx).repost(message.channelId).catch((err: unknown) => ctx.logger.warn({ err, channelId: message.channelId }, 'Sticky message not reposted'));
  }, delayMs);
  timer.unref();
  timers.set(message.channelId, { timer, delayMs });
}

/** Timers do not outlive the cluster. */
export function clearStickyTimers(): void {
  generation++;
  for (const { timer } of timers.values()) clearTimeout(timer);
  timers.clear();
  stickyCache.clear();
  loading.clear();
}
