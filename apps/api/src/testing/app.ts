import type { GuildChannel, GuildMeta, GuildRole } from '@bot/contracts';
import {
  ConfigService,
  EventBus,
  GuildLocales,
  ModuleRegistry,
  PrismaConfigStore,
  RedisConfigCache,
  RedisKeys,
  Scheduler,
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
import { FakeDiscordOAuth, TEST_USER } from './fake-oauth.js';
import { FakeRest } from './fake-rest.js';

export interface TestApp {
  app: FastifyInstance;
  oauth: FakeDiscordOAuth;
  rest: FakeRest;
  deps: ApiDeps;
  database: TestDatabase;
  redis: Redis;
  close(): Promise<void>;
}

export interface TestAppOptions {
  modules?: AnyModule[];
  rateLimitPerMinute?: number;
}

/** API on top of SQLite and in-memory Redis; requests go through `app.inject`. */
export async function createTestApp({ modules = [], rateLimitPerMinute = 0 }: TestAppOptions = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  const redis = createTestRedis();
  const logger = createLogger({ service: 'api-test', level: process.env.TEST_LOG_LEVEL ?? 'silent', pretty: false });

  const oauth = new FakeDiscordOAuth();
  const rest = new FakeRest();
  const registry = new ModuleRegistry(modules);
  const i18n = new I18n('ru');
  registerCoreLocales(i18n);
  registry.registerLocales(i18n);

  const guildLocales = new GuildLocales(database.db, i18n);
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
      locales: { localeOf: (guildId) => guildLocales.get(guildId), i18n },
      logger,
    }),
    scheduler: new Scheduler(database.db),
    guildLocales,
    rest: rest.asRest(),
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
      rateLimitPerMinute,
    },
  };

  const app = await buildServer(deps);
  await app.ready();

  return {
    app,
    oauth,
    rest,
    deps,
    database,
    redis,
    async close() {
      await app.close();
      await database.cleanup();
    },
  };
}

export const GUILD_ID = '300000000000000003';
export const ROLE_ID = '400000000000000004';
export const CHANNEL_ID = '500000000000000005';

/** Guild snapshot in Redis — the same way the bot writes it. */
export async function seedGuildSnapshot(t: TestApp, guildId = GUILD_ID): Promise<void> {
  const meta: GuildMeta = { id: guildId, name: 'Test guild', icon: null, ownerId: TEST_USER.id, memberCount: 10, shardId: 0 };
  const roles: GuildRole[] = [
    { id: guildId, name: '@everyone', color: 0, position: 0, managed: false, manageable: false },
    { id: ROLE_ID, name: 'Moderator', color: 0xff0000, position: 1, managed: false, manageable: true },
  ];
  const channels: GuildChannel[] = [{ id: CHANNEL_ID, name: 'general', type: 0, parentId: null, position: 0 }];
  await t.redis
    .multi()
    .set(RedisKeys.guildMeta(guildId), JSON.stringify(meta))
    .set(RedisKeys.guildRoles(guildId), JSON.stringify(roles))
    .set(RedisKeys.guildChannels(guildId), JSON.stringify(channels))
    .set(RedisKeys.guildEmojis(guildId), JSON.stringify([]))
    .exec();
}

/** Logs in through the fake Discord and returns the session cookie. */
export async function login(t: TestApp): Promise<string> {
  const start = await t.app.inject('/v1/auth/login');
  const state = new URL(start.headers.location!).searchParams.get('state');
  const callback = await t.app.inject(`/v1/auth/callback?code=valid-code&state=${state}`);
  const cookie = callback.cookies.find((c) => c.name === 'sid');
  if (!cookie) throw new Error(`Login failed: ${callback.statusCode} ${callback.body}`);
  return `sid=${cookie.value}`;
}
