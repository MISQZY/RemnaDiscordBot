import type { ConfigService, EventBus, ModuleRegistry } from '@bot/core';
import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotReader } from '@bot/discord';
import type { I18n } from '@bot/i18n';
import type { Logger } from '@bot/logger';
import type { Redis } from 'ioredis';

/** Всё, от чего зависит сервер; собирается в index.ts, в тестах — из SQLite и мока Redis. */
export interface ApiDeps {
  logger: Logger;
  db: PrismaClient;
  redis: Redis;
  i18n: I18n;
  bus: EventBus;
  registry: ModuleRegistry;
  config: ConfigService;
  snapshots: GuildSnapshotReader;
  options: ApiOptions;
}

export interface ApiOptions {
  publicUrl: string;
  /** Адрес веба: CORS и редирект после входа. */
  webOrigin: string;
  /** Swagger UI на `/docs`. */
  docs: boolean;
}
