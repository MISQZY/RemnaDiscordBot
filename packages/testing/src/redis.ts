import { createRequire } from 'node:module';
import type { Redis } from 'ioredis';

// CommonJS-пакет без ESM-типов; повторяет API ioredis, поэтому типизируется им.
const RedisMock = createRequire(import.meta.url)('ioredis-mock') as new (options: { port: number }) => Redis;

let nextPort = 40_000;

/**
 * In-memory Redis для тестов. ioredis-mock делит данные между клиентами с одинаковым
 * host:port, поэтому каждый вызов получает свой «порт» — и свою изолированную базу.
 * Клиенты из `duplicate()` видят те же данные и pub/sub.
 */
export function createTestRedis(): Redis {
  return new RedisMock({ port: nextPort++ });
}
