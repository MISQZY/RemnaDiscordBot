import {
  ConfigService,
  EventBus,
  ModuleRegistry,
  PrismaConfigStore,
  RedisConfigCache,
  publishConfigInvalidation,
  registerCoreLocales,
  type AnyModule,
} from '@bot/core';
import { GuildSnapshotReader } from '@bot/discord';
import { I18n } from '@bot/i18n';
import { createLogger } from '@bot/logger';
import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { ApiDeps } from '../deps.js';
import { buildServer } from '../server.js';

export interface TestApp {
  app: FastifyInstance;
  deps: ApiDeps;
  database: TestDatabase;
  redis: Redis;
  close(): Promise<void>;
}

export interface TestAppOptions {
  modules?: AnyModule[];
}

/** API поверх SQLite и in-memory Redis; запросы — через `app.inject`. */
export async function createTestApp({ modules = [] }: TestAppOptions = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  const redis = createTestRedis();
  const logger = createLogger({ service: 'api-test', level: 'silent', pretty: false });

  const registry = new ModuleRegistry(modules);
  const i18n = new I18n('ru');
  registerCoreLocales(i18n);
  registry.registerLocales(i18n);

  const deps: ApiDeps = {
    logger,
    db: database.db,
    redis,
    i18n,
    bus: new EventBus(logger),
    registry,
    config: new ConfigService({
      registry,
      store: new PrismaConfigStore(database.db),
      sharedCache: new RedisConfigCache(redis),
      publish: (message) => publishConfigInvalidation(redis, message),
      logger,
    }),
    snapshots: new GuildSnapshotReader(redis),
    options: {
      publicUrl: 'http://api.test',
      webOrigin: 'http://web.test',
      docs: true,
    },
  };

  const app = await buildServer(deps);
  await app.ready();

  return {
    app,
    deps,
    database,
    redis,
    async close() {
      await app.close();
      await database.cleanup();
    },
  };
}
