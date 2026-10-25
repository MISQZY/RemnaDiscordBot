import { createLogger } from '@bot/logger';
import { createTestRedis } from '@bot/testing';
import { describe, expect, it } from 'vitest';
import { RedisIdentifyThrottler } from './identify.js';

const logger = createLogger({ service: 'test', level: 'silent', pretty: false });

describe('RedisIdentifyThrottler', () => {
  it('takes a free bucket at once and holds it for the window', async () => {
    const redis = createTestRedis();
    await new RedisIdentifyThrottler(redis, 1, logger).waitForIdentify(0, new AbortController().signal);
    expect(await redis.pttl('bot:identify:0')).toBeGreaterThan(5_000);
  });

  it('waits for the turn of a bucket another server holds', async () => {
    const redis = createTestRedis();
    await redis.set('bot:identify:0', 'other', 'PX', 300);
    const started = Date.now();
    await new RedisIdentifyThrottler(redis, 1, logger).waitForIdentify(4, new AbortController().signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it('keeps buckets of a higher concurrency apart', async () => {
    const redis = createTestRedis();
    await redis.set('bot:identify:0', 'other', 'PX', 60_000);
    await new RedisIdentifyThrottler(redis, 16, logger).waitForIdentify(1, new AbortController().signal);
    expect(await redis.exists('bot:identify:1')).toBe(1);
  });

  it('stops waiting when aborted', async () => {
    const redis = createTestRedis();
    await redis.set('bot:identify:0', 'other', 'PX', 60_000);
    const controller = new AbortController();
    const wait = new RedisIdentifyThrottler(redis, 1, logger).waitForIdentify(0, controller.signal);
    controller.abort();
    await expect(wait).rejects.toThrow();
  });
});
