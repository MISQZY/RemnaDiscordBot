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

/** Shared process services (bot, API, worker) available to modules. */
export interface CoreServices {
  logger: Logger;
  db: PrismaClient;
  redis: Redis;
  i18n: I18n;
  bus: EventBus;
  config: ConfigService;
  scheduler: Scheduler;
  /** Guild language for public messages. */
  guildLocales: GuildLocales;
  /** Discord REST as the bot: works without the gateway (API, worker). */
  rest: REST;
}

export interface BotServices extends CoreServices {
  client: Client;
  /** All bot modules — for built-in commands like `/help` and `/modules`. */
  registry: ModuleRegistry;
}

/** Services bound to a module: a logger with `moduleId` and reading its config. */
export interface ModuleServices<TConfig> extends CoreServices {
  moduleId: string;
  getConfig(guildId: string): Promise<TConfig>;
}

/** Context of module routes in the API. */
export interface ApiModuleContext<TConfig> extends ModuleServices<TConfig> {
  /** The logged-in user's Discord ID; guild access is already checked. */
  currentUserId(request: FastifyRequest): string;
  /** Guild channels and roles from the snapshot — for checking references in module data. */
  guildEntities(guildId: string): Promise<GuildEntities>;
}

/** Context of a module's scheduled job in the worker. */
export interface JobContext<TConfig> extends ModuleServices<TConfig> {
  guildId: string;
  /** Aborted when the job runs out of time: a long job should stop instead of going on next to its retry. */
  signal: AbortSignal;
}

/** Context a module handler receives in the bot. */
export interface BotModuleContext<TConfig> extends ModuleServices<TConfig> {
  client: Client;
  registry: ModuleRegistry;
}
