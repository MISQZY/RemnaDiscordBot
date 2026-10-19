import type { PrismaClient } from '@bot/db';
import type { I18n } from '@bot/i18n';
import type { Logger } from '@bot/logger';
import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type { EventBus } from './bus.js';
import type { ConfigService } from './config/service.js';

/** Общие сервисы процесса, доступные модулям. */
export interface CoreServices {
  logger: Logger;
  db: PrismaClient;
  redis: Redis;
  i18n: I18n;
  bus: EventBus;
  config: ConfigService;
}

export interface BotServices extends CoreServices {
  client: Client;
}

/** Контекст, который получает обработчик модуля в боте. */
export interface BotModuleContext<TConfig> extends BotServices {
  moduleId: string;
  getConfig(guildId: string): Promise<TConfig>;
}
