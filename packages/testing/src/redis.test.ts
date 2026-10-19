import { describe, expect, it } from 'vitest';
import { createTestRedis } from './redis.js';

/** Checks that the mock supports the commands the bot's code relies on. */
describe('createTestRedis', () => {
  it('isolates data between instances', async () => {
    const a = createTestRedis();
    const b = createTestRedis();
    await a.set('key', '1');

    expect(await a.get('key')).toBe('1');
    expect(await b.get('key')).toBeNull();
  });

  it('supports SET PX NX and PTTL for cooldowns', async () => {
    const redis = createTestRedis();

    expect(await redis.set('cd', '1', 'PX', 5000, 'NX')).toBe('OK');
    expect(await redis.set('cd', '1', 'PX', 5000, 'NX')).toBeNull();
    expect(await redis.pttl('cd')).toBeGreaterThan(0);
  });

  it('supports MULTI', async () => {
    const redis = createTestRedis();
    await redis.multi().set('a', '1').set('b', '2').exec();

    expect(await redis.get('a')).toBe('1');
    expect(await redis.get('b')).toBe('2');
  });

  it('delivers pub/sub messages to duplicated clients', async () => {
    const redis = createTestRedis();
    const subscriber = redis.duplicate();
    const received = new Promise<string>((resolve) => subscriber.on('message', (_channel: string, message: string) => resolve(message)));
    await subscriber.subscribe('channel');

    await redis.publish('channel', 'hello');

    expect(await received).toBe('hello');
  });
});
