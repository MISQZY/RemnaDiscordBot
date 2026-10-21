import type { BotModuleContext } from '@bot/core';
import type { Message } from 'discord.js';
import type { MessagesConfig } from './config.js';
import { MessageService, stickyKey } from './service.js';

/** One timer per channel: the sticky message is posted again once the channel is quiet. */
const timers = new Map<string, NodeJS.Timeout>();

export async function onMessage(ctx: BotModuleContext<MessagesConfig>, message: Message): Promise<void> {
  if (!message.inGuild() || message.author.id === ctx.client.user?.id) return;
  if (!(await ctx.redis.exists(stickyKey(message.channelId)))) return;
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
}
