import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModuleRegistry } from '../registry.js';
import { createTestModule, testLogger } from '../testing/fixtures.js';
import { publishConfigInvalidation, subscribeConfigInvalidation } from './pubsub.js';
import { ConfigService } from './service.js';
import { RedisConfigCache } from './shared-cache.js';
import { PrismaConfigStore } from './store.js';

const GUILD = '111111111111111111';

/** Сервис так, как его собирает процесс бота или API. */
function createService(database: TestDatabase, redis: Redis): ConfigService {
  return new ConfigService({
    registry: new ModuleRegistry([createTestModule('leveling')]),
    store: new PrismaConfigStore(database.db),
    sharedCache: new RedisConfigCache(redis),
    publish: (message) => publishConfigInvalidation(redis, message),
    logger: testLogger,
  });
}

describe('ConfigService with database and Redis', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.cleanup();
  });

  it('persists updates and creates the guild row', async () => {
    const service = createService(database, createTestRedis());

    await service.update(GUILD, 'leveling', { enabled: true, config: { xpPerMessage: 25, announce: false } }, 'admin');

    const row = await database.db.guildModuleConfig.findUnique({
      where: { guildId_moduleId: { guildId: GUILD, moduleId: 'leveling' } },
    });
    expect(row).toMatchObject({ enabled: true, config: { xpPerMessage: 25, announce: false }, version: 1, updatedBy: 'admin' });
    expect(await database.db.guild.findUnique({ where: { id: GUILD } })).not.toBeNull();
  });

  it('propagates updates to another process through pub/sub', async () => {
    const redis = createTestRedis();
    const api = createService(database, redis);
    const bot = createService(database, redis);

    const invalidated = vi.fn();
    const unsubscribe = await subscribeConfigInvalidation(redis, testLogger, (message) => {
      bot.invalidate(message);
      invalidated(message);
    });

    // Бот закэшировал старое значение.
    const before = await bot.get(GUILD, 'leveling');

    await api.update(GUILD, 'leveling', { config: { xpPerMessage: 40, announce: true } });
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalledWith({ guildId: GUILD, moduleId: 'leveling' }));

    expect(await bot.get(GUILD, 'leveling')).toMatchObject({ enabled: before.enabled, config: { xpPerMessage: 40, announce: true } });
    await unsubscribe();
  });

  it('reads through the shared cache after the first load', async () => {
    const redis = createTestRedis();
    const service = createService(database, redis);
    const guildId = '222222222222222222';

    await service.get(guildId, 'leveling');

    expect(await redis.get(`cfg:${guildId}:leveling`)).toBe('none');
  });
});
