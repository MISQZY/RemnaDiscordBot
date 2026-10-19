import { createRequire } from 'node:module';
import type { Redis } from 'ioredis';

// A CommonJS package without ESM types; it mirrors ioredis's API, so it is typed with it.
const RedisMock = createRequire(import.meta.url)('ioredis-mock') as new (options: { port: number }) => Redis;

let nextPort = 40_000;

/**
 * In-memory Redis for tests. ioredis-mock shares data between clients with the same
 * host:port, so each call gets its own "port" — and its own isolated database.
 * Clients from `duplicate()` see the same data and pub/sub.
 */
export function createTestRedis(): Redis {
  return new RedisMock({ port: nextPort++ });
}
