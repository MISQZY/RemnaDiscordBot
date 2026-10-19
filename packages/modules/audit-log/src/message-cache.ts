import type { Redis } from 'ioredis';

/**
 * Our own message text cache: discord.js does not cache messages (the bot is configured so),
 * and on deletion Discord only sends the ID. Stored only for guilds
 * that have message logging enabled.
 */
export interface CachedMessage {
  authorId: string;
  channelId: string;
  content: string;
  attachments: string[];
  createdAt: number;
}

const TTL_SEC = 3 * 24 * 60 * 60;
const key = (messageId: string) => `audit:msg:${messageId}`;

export class MessageCache {
  constructor(private readonly redis: Redis) {}

  async set(messageId: string, message: CachedMessage): Promise<void> {
    await this.redis.set(key(messageId), JSON.stringify({ ...message, content: message.content.slice(0, 4000) }), 'EX', TTL_SEC);
  }

  async get(messageId: string): Promise<CachedMessage | null> {
    const raw = await this.redis.get(key(messageId));
    return raw ? (JSON.parse(raw) as CachedMessage) : null;
  }

  async delete(messageId: string): Promise<void> {
    await this.redis.del(key(messageId));
  }
}
