import type { CoreServices } from '@bot/core';

type Redis = CoreServices['redis'];

/**
 * Records an item in a sliding window and returns the items still in it, newest first. A list keeps only the last
 * `limit` items: reaching the limit within the window is all the filters need to know.
 */
export async function recordInWindow(
  redis: Redis,
  key: string,
  item: string,
  { limit, windowMs, now = Date.now() }: { limit: number; windowMs: number; now?: number },
): Promise<string[]> {
  await redis
    .multi()
    .lpush(key, `${now}|${item}`)
    .ltrim(key, 0, limit - 1)
    .pexpire(key, windowMs + 5_000)
    .exec();
  const entries = await redis.lrange(key, 0, -1);
  return entries.flatMap((entry) => {
    const separator = entry.indexOf('|');
    return Number(entry.slice(0, separator)) > now - windowMs ? [entry.slice(separator + 1)] : [];
  });
}
