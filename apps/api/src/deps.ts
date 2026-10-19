import type { ConfigService, EventBus, ModuleRegistry } from '@bot/core';
import type { PrismaClient } from '@bot/db';
import type { GuildSnapshotReader } from '@bot/discord';
import type { I18n } from '@bot/i18n';
import type { Logger } from '@bot/logger';
import type { Redis } from 'ioredis';
import type { DiscordOAuth } from './auth/discord-oauth.js';

/** Всё, от чего зависит сервер; собирается в index.ts, в тестах — из SQLite, мока Redis и фейка Discord. */
export interface ApiDeps {
  logger: Logger;
  db: PrismaClient;
  redis: Redis;
  i18n: I18n;
  bus: EventBus;
  registry: ModuleRegistry;
  config: ConfigService;
  snapshots: GuildSnapshotReader;
  oauth: DiscordOAuth;
  options: ApiOptions;
}

export interface ApiOptions {
  publicUrl: string;
  /** Адрес веба: CORS и редирект после входа. */
  webOrigin: string;
  /** Куда вести после входа, если веб не передал путь. */
  defaultRedirect: string;
  clientId: string;
  /** Подпись cookie и ключ шифрования токенов. */
  sessionSecret: string;
  secureCookies: boolean;
  /** Swagger UI на `/docs`. */
  docs: boolean;
  /** Глобальный лимит запросов в минуту на пользователя/IP; 0 — без лимита. */
  rateLimitPerMinute: number;
}
