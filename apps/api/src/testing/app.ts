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
import { FakeDiscordOAuth } from './fake-oauth.js';

export interface TestApp {
  app: FastifyInstance;
  oauth: FakeDiscordOAuth;
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

  const oauth = new FakeDiscordOAuth();
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
    oauth,
    options: {
      publicUrl: 'http://api.test',
      webOrigin: 'http://web.test',
      defaultRedirect: '/',
      clientId: '200000000000000002',
      sessionSecret: 'test-session-secret-at-least-32-characters',
      secureCookies: false,
      docs: true,
    },
  };

  const app = await buildServer(deps);
  await app.ready();

  return {
    app,
    oauth,
    deps,
    database,
    redis,
    async close() {
      await app.close();
      await database.cleanup();
    },
  };
}

/** Проходит вход через фейковый Discord и возвращает cookie сессии. */
export async function login(t: TestApp): Promise<string> {
  const start = await t.app.inject('/v1/auth/login');
  const state = new URL(start.headers.location!).searchParams.get('state');
  const callback = await t.app.inject(`/v1/auth/callback?code=valid-code&state=${state}`);
  const cookie = callback.cookies.find((c) => c.name === 'sid');
  if (!cookie) throw new Error(`Login failed: ${callback.statusCode} ${callback.body}`);
  return `sid=${cookie.value}`;
}
