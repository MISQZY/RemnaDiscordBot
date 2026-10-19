import type { PrismaClient } from '@bot/db';
import type { I18n } from '@bot/i18n';
import type { Logger } from '@bot/logger';
import type { Client, REST } from 'discord.js';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { EventBus } from './bus.js';
import type { ConfigService } from './config/service.js';
import type { GuildLocales } from './guild-locales.js';
import type { Scheduler } from './jobs/scheduler.js';
import type { ModuleRegistry } from './registry.js';
import type { GuildEntities } from './validation.js';

/** Общие сервисы процесса (бот, API, воркер), доступные модулям. */
export interface CoreServices {
  logger: Logger;
  db: PrismaClient;
  redis: Redis;
  i18n: I18n;
  bus: EventBus;
  config: ConfigService;
  scheduler: Scheduler;
  /** Язык гильдии для публичных сообщений. */
  guildLocales: GuildLocales;
  /** Discord REST от имени бота: работает без gateway (API, воркер). */
  rest: REST;
}

export interface BotServices extends CoreServices {
  client: Client;
  /** Все модули бота — для служебных команд вроде `/help` и `/modules`. */
  registry: ModuleRegistry;
}

/** Сервисы, привязанные к модулю: логгер с `moduleId` и чтение его конфига. */
export interface ModuleServices<TConfig> extends CoreServices {
  moduleId: string;
  getConfig(guildId: string): Promise<TConfig>;
}

/** Контекст роутов модуля в API. */
export interface ApiModuleContext<TConfig> extends ModuleServices<TConfig> {
  /** Discord ID вошедшего пользователя; доступ к гильдии уже проверен. */
  currentUserId(request: FastifyRequest): string;
  /** Каналы и роли гильдии из снапшота — для проверки ссылок в данных модуля. */
  guildEntities(guildId: string): Promise<GuildEntities>;
}

/** Контекст отложенной задачи модуля в воркере. */
export interface JobContext<TConfig> extends ModuleServices<TConfig> {
  guildId: string;
}

/** Контекст, который получает обработчик модуля в боте. */
export interface BotModuleContext<TConfig> extends ModuleServices<TConfig> {
  client: Client;
  registry: ModuleRegistry;
}
