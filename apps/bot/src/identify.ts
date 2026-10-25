import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { RedisKeys } from '@bot/core';
import type { Logger } from '@bot/logger';
import type { WebSocketOptions } from 'discord.js';
import type { Redis } from 'ioredis';

/** `IIdentifyThrottler` of @discordjs/ws, which the bot does not depend on directly. */
type IdentifyThrottler = Awaited<ReturnType<NonNullable<WebSocketOptions['buildIdentifyThrottler']>>>;

/** Discord allows one IDENTIFY per rate limit bucket every 5 seconds; a little over it absorbs clock and network jitter. */
const IDENTIFY_WINDOW_MS = 5_500;

/**
 * Identify rate limit shared by every cluster on every server: each manager paces its own clusters only, so without
 * it shards of different servers identify at once and Discord drops them. A bucket's key in Redis is held for the
 * window and never released — its expiry is the next shard's turn. When Redis does not answer, the shard waits a full
 * window and goes anyway, as a single server would.
 */
export class RedisIdentifyThrottler implements IdentifyThrottler {
  constructor(
    private readonly redis: Redis,
    private readonly maxConcurrency: number,
    private readonly logger: Logger,
  ) {}

  async waitForIdentify(shardId: number, signal: AbortSignal): Promise<void> {
    const key = RedisKeys.identifyBucket(shardId % this.maxConcurrency);
    const token = randomUUID();
    while (true) {
      signal.throwIfAborted();
      let wait: number;
      try {
        if ((await this.redis.set(key, token, 'PX', IDENTIFY_WINDOW_MS, 'NX')) === 'OK') return;
        wait = await this.redis.pttl(key);
      } catch (err) {
        this.logger.warn({ err, shardId }, 'Identify lock unavailable, waiting a full window');
        await sleep(IDENTIFY_WINDOW_MS, undefined, { signal });
        return;
      }
      await sleep(Math.max(wait, 100), undefined, { signal });
    }
  }
}
