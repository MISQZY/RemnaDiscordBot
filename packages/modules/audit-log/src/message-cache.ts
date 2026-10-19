import type { Redis } from 'ioredis';

/**
 * Свой кэш текста сообщений: discord.js сообщения не кэширует (так настроен бот),
 * а при удалении Discord присылает только ID. Хранится только для гильдий,
 * где включено логирование сообщений.
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
