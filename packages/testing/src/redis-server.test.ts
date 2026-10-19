import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMemoryRedisServer, type MemoryRedisServer } from './redis-server.js';

/** Настоящий клиент ioredis против сервера — так же к нему подключаются бот и API. */
describe('startMemoryRedisServer', () => {
  let server: MemoryRedisServer;
  const clients: Redis[] = [];
  const connect = () => {
    const client = new Redis(server.url, { maxRetriesPerRequest: 1 });
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    server = await startMemoryRedisServer();
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await server.close();
  });

  it('shares data between connections', async () => {
    const a = connect();
    const b = connect();
    await a.set('shared', 'value');

    expect(await b.get('shared')).toBe('value');
    expect(await b.get('missing')).toBeNull();
    expect(await a.exists('shared', 'missing')).toBe(1);
  });

  it('supports cooldown commands', async () => {
    const redis = connect();

    expect(await redis.set('cd', '1', 'PX', 5000, 'NX')).toBe('OK');
    expect(await redis.set('cd', '1', 'PX', 5000, 'NX')).toBeNull();
    expect(await redis.pttl('cd')).toBeGreaterThan(0);
  });

  it('supports MULTI/EXEC', async () => {
    const redis = connect();
    const results = await redis.multi().set('m1', 'a').incr('m2').exec();

    expect(results).toEqual([
      [null, 'OK'],
      [null, 1],
    ]);
    expect(await redis.get('m1')).toBe('a');
  });

  it('delivers pub/sub messages across connections', async () => {
    const publisher = connect();
    const subscriber = connect();
    const received = new Promise<string>((resolve) => subscriber.on('message', (_channel: string, message: string) => resolve(message)));
    await subscriber.subscribe('events');

    await publisher.publish('events', 'hello');

    expect(await received).toBe('hello');
  });

  it('reports unknown commands as errors', async () => {
    const redis = connect();
    await expect(redis.call('NOSUCHCOMMAND')).rejects.toThrow(/unknown command/);
  });
});
