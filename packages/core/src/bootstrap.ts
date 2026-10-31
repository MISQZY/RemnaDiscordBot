import type { Locale } from '@bot/contracts';
import type { Logger } from '@bot/logger';
import { createDatabaseClient, type PrismaClient } from '@bot/db';
import { I18n } from '@bot/i18n';
import { Redis } from 'ioredis';
import { ConfigService } from './config/service.js';
import { PrismaConfigStore } from './config/store.js';
import { RedisConfigCache } from './config/shared-cache.js';
import { publishConfigInvalidation, subscribeConfigInvalidation } from './config/pubsub.js';
import { GuildLocales } from './guild-locales.js';
import { registerCoreLocales } from './locales.js';
import type { AnyModule } from './module.js';
import { ModuleRegistry } from './registry.js';
import { VipAccess } from './vip/access.js';
import { PrismaVipStore } from './vip/store.js';

export interface BootstrapOptions {
  databaseUrl: string;
  redisUrl: string;
  defaultLocale?: Locale;
  modules: AnyModule[];
  logger: Logger;
}

export interface BootstrappedServices {
  db: PrismaClient;
  redis: Redis;
  registry: ModuleRegistry;
  i18n: I18n;
  guildLocales: GuildLocales;
  vip: VipAccess;
  config: ConfigService;
  close: () => Promise<void>;
}

/** Initializes the shared core services: database, Redis, module registry, localization, VIP and config management. */
export async function bootstrapServices({
  databaseUrl,
  redisUrl,
  defaultLocale = 'ru',
  modules,
  logger,
}: BootstrapOptions): Promise<BootstrappedServices> {
  const db = await createDatabaseClient(databaseUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  redis.on('error', (err) => logger.error({ err }, 'Redis error'));

  const registry = new ModuleRegistry(modules);
  const i18n = new I18n(defaultLocale);
  registerCoreLocales(i18n);
  registry.registerLocales(i18n);

  const guildLocales = new GuildLocales(db, i18n);
  const vip = new VipAccess(new PrismaVipStore(db));
  const stopVip = await vip.start(redis, logger);

  const config = new ConfigService({
    registry,
    vip,
    store: new PrismaConfigStore(db),
    sharedCache: new RedisConfigCache(redis),
    publish: (message) => publishConfigInvalidation(redis, message),
    locales: { localeOf: (guildId) => guildLocales.get(guildId), i18n },
    logger,
  });

  const unsubscribeConfig = await subscribeConfigInvalidation(redis, logger, (message) => {
    config.invalidate(message);
    if (!message.moduleId) guildLocales.invalidate(message.guildId);
  });

  const close = async () => {
    unsubscribeConfig();
    stopVip();
    await redis.quit().catch(() => {});
    await db.$disconnect().catch(() => {});
  };

  return { db, redis, registry, i18n, guildLocales, vip, config, close };
}
