import type { Logger } from '@bot/logger';
import type { APIEmbed, Guild } from 'discord.js';
import type { LogCategory } from './config.js';

export interface AuditLogBatcherOptions {
  /** Delay in milliseconds before flushing non-full queues (default: 500ms, 5ms in test). */
  waitMs?: number;
  /** Maximum number of items in the queue per channel (default: 100). */
  maxQueue?: number;
  /** Maximum number of embeds per message (Discord limit: 10). */
  maxBatchSize?: number;
  /** Maximum total characters across all embeds in a single message (Discord limit: 6000, default: 5500). */
  maxChars?: number;
}

export interface EnqueueItem {
  guild: Guild;
  channelId: string;
  category: LogCategory;
  embed: APIEmbed;
  logger: Logger;
}

interface QueuedItem extends EnqueueItem {
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface ChannelQueue {
  items: QueuedItem[];
  timer: NodeJS.Timeout | null;
  flushing: boolean;
  guild: Guild;
  logger: Logger;
}

/** Total character count across embed fields checked by Discord's 6000-char per-message limit. */
export function embedLength(embed: APIEmbed): number {
  let len = 0;
  if (embed.title) len += embed.title.length;
  if (embed.description) len += embed.description.length;
  if (embed.author?.name) len += embed.author.name.length;
  if (embed.footer?.text) len += embed.footer.text.length;
  if (embed.fields) {
    for (const field of embed.fields) {
      len += (field.name?.length ?? 0) + (field.value?.length ?? 0);
    }
  }
  return len;
}

export class AuditLogBatcher {
  readonly waitMs: number;
  readonly maxQueue: number;
  readonly maxBatchSize: number;
  readonly maxChars: number;

  private readonly queues = new Map<string, ChannelQueue>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: AuditLogBatcherOptions = {}) {
    this.waitMs = options.waitMs ?? (process.env.NODE_ENV === 'test' ? 5 : 500);
    this.maxQueue = options.maxQueue ?? 100;
    this.maxBatchSize = options.maxBatchSize ?? 10;
    this.maxChars = options.maxChars ?? 5500;
  }

  enqueue(item: EnqueueItem): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let queue = this.queues.get(item.channelId);
      if (!queue) {
        queue = {
          items: [],
          timer: null,
          flushing: false,
          guild: item.guild,
          logger: item.logger,
        };
        this.queues.set(item.channelId, queue);
      } else {
        queue.guild = item.guild;
        queue.logger = item.logger;
      }

      if (queue.items.length >= this.maxQueue) {
        queue.logger.warn(
          { guildId: item.guild.id, channelId: item.channelId, category: item.category },
          'Audit log queue full, dropping event',
        );
        resolve();
        return;
      }

      queue.items.push({ ...item, resolve, reject });

      // If we already reached a full batch, flush immediately without waiting for debounce
      if (queue.items.length >= this.maxBatchSize && !queue.flushing) {
        if (queue.timer) {
          clearTimeout(queue.timer);
          queue.timer = null;
        }
        void this.flush(item.channelId);
      } else if (!queue.timer && !queue.flushing) {
        queue.timer = setTimeout(() => {
          if (queue) queue.timer = null;
          void this.flush(item.channelId);
        }, this.waitMs);
      }
    });
  }

  flush(channelId: string): Promise<void> {
    const running = this.inFlight.get(channelId);
    if (running) return running;
    const task = this.flushQueue(channelId).finally(() => this.inFlight.delete(channelId));
    this.inFlight.set(channelId, task);
    return task;
  }

  private async flushQueue(channelId: string): Promise<void> {
    const queue = this.queues.get(channelId);
    if (!queue || queue.flushing || queue.items.length === 0) return;

    if (queue.timer) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }

    queue.flushing = true;
    try {
      while (queue.items.length > 0) {
        const batch: QueuedItem[] = [];
        let totalLength = 0;

        while (queue.items.length > 0 && batch.length < this.maxBatchSize) {
          const next = queue.items[0]!;
          const nextLen = embedLength(next.embed);
          if (batch.length > 0 && totalLength + nextLen > this.maxChars) {
            break;
          }
          batch.push(queue.items.shift()!);
          totalLength += nextLen;
        }

        const channel =
          queue.guild.channels.cache.get(channelId) ?? (await queue.guild.channels.fetch(channelId).catch(() => null));
        if (!channel?.isSendable()) {
          queue.logger.warn(
            { guildId: queue.guild.id, channelId },
            'Audit log channel is missing or not writable',
          );
          for (const item of batch) item.resolve();
          continue;
        }

        try {
          await channel.send({
            embeds: batch.map((b) => b.embed),
            allowedMentions: { parse: [] },
          });
        } catch (err) {
          queue.logger.error({ err, guildId: queue.guild.id, channelId }, 'Failed to send audit log batch');
        }

        for (const item of batch) {
          item.resolve();
        }

        // If remaining items are less than a full batch, schedule debounce delay instead of sending immediately
        if (queue.items.length > 0 && queue.items.length < this.maxBatchSize) {
          queue.timer = setTimeout(() => {
            if (queue) queue.timer = null;
            void this.flush(channelId);
          }, this.waitMs);
          break;
        }
      }
    } finally {
      queue.flushing = false;
      if (queue.items.length === 0 && !queue.timer) {
        this.queues.delete(channelId);
      }
    }
  }

  async flushAll(): Promise<void> {
    const channelIds = Array.from(this.queues.keys());
    await Promise.all(
      channelIds.map(async (channelId) => {
        const queue = this.queues.get(channelId);
        if (queue?.timer) {
          clearTimeout(queue.timer);
          queue.timer = null;
        }
        while (this.queues.has(channelId) || this.inFlight.has(channelId)) {
          await this.flush(channelId);
        }
      }),
    );
  }

  destroy(): void {
    for (const queue of this.queues.values()) {
      if (queue.timer) {
        clearTimeout(queue.timer);
        queue.timer = null;
      }
      for (const item of queue.items) {
        item.resolve();
      }
    }
    this.queues.clear();
  }
}
