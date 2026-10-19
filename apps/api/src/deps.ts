import type { CoreServices, ModuleRegistry } from '@bot/core';
import type { GuildSnapshotReader } from '@bot/discord';
import type { DiscordOAuth } from './auth/discord-oauth.js';

/** Всё, от чего зависит сервер; собирается в index.ts, в тестах — из SQLite, мока Redis и фейка Discord. */
export interface ApiDeps extends CoreServices {
  registry: ModuleRegistry;
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
