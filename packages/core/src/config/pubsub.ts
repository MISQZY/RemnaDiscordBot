import { ConfigInvalidation } from '@bot/contracts';
import type { Logger } from '@bot/logger';
import type { Redis } from 'ioredis';
import { RedisChannels } from '../redis-keys.js';

export async function publishConfigInvalidation(redis: Redis, message: ConfigInvalidation): Promise<void> {
  await redis.publish(RedisChannels.configInvalidate, JSON.stringify(message));
}

/**
 * Подписка на инвалидацию конфигов. Использует отдельное подключение:
 * Redis-клиент в режиме подписки не может выполнять обычные команды.
 */
export async function subscribeConfigInvalidation(
  redis: Redis,
  logger: Logger,
  onMessage: (message: ConfigInvalidation) => void,
): Promise<() => Promise<void>> {
  const subscriber = redis.duplicate();
  subscriber.on('message', (channel: string, raw: string) => {
    if (channel !== RedisChannels.configInvalidate) return;
    try {
      const parsed = ConfigInvalidation.safeParse(JSON.parse(raw));
      if (parsed.success) onMessage(parsed.data);
      else logger.warn({ raw }, 'Malformed config invalidation message');
    } catch (err) {
      logger.warn({ err, raw }, 'Malformed config invalidation message');
    }
  });
  await subscriber.subscribe(RedisChannels.configInvalidate);

  return async () => {
    await subscriber.unsubscribe(RedisChannels.configInvalidate);
    subscriber.disconnect();
  };
}
