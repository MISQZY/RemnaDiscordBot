import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';
import type {
  AutocompleteInteraction,
  Awaitable,
  ChatInputCommandInteraction,
  ClientEvents,
  GatewayIntentBits,
  Partials,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { ApiModuleContext, BotModuleContext, JobContext, ModuleServices } from './context.js';
import type { ConfigIssue, GuildEntities } from './validation.js';

/** Контекст interaction: контекст модуля + локаль пользователя. */
export interface InteractionContext<TConfig> extends BotModuleContext<TConfig> {
  locale: Locale;
  t(key: string, vars?: Record<string, string | number>): string;
}

export interface SlashCommand<TConfig = unknown> {
  /** `SlashCommandBuilder` или любой объект с тем же контрактом. */
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  cooldownMs?: number;
  execute(interaction: ChatInputCommandInteraction, ctx: InteractionContext<TConfig>): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: InteractionContext<TConfig>): Promise<void>;
}

export interface ComponentHandler<TConfig = unknown> {
  handle(
    interaction: MessageComponentInteraction | ModalSubmitInteraction,
    ctx: InteractionContext<TConfig>,
  ): Promise<void>;
}

export type EventHandlers<TConfig> = {
  [E in keyof ClientEvents]?: (ctx: BotModuleContext<TConfig>, ...args: ClientEvents[E]) => Awaitable<void>;
};

export interface BotFacet<TConfig> {
  /** Gateway intents, нужные модулю; бот подключается с их объединением. */
  intents?: GatewayIntentBits[];
  /** Partials discord.js — события по объектам не из кэша (удаление старых сообщений и т.п.). */
  partials?: Partials[];
  commands?: SlashCommand<TConfig>[];
  events?: EventHandlers<TConfig>;
  /** Обработчики компонентов по префиксу `customId` (часть до первого `:`). */
  components?: Record<string, ComponentHandler<TConfig>>;
}

export interface ModuleDefinition<TSchema extends z.ZodType = z.ZodType> {
  /** Стабильный идентификатор: используется в БД, URL и ключах кэша. */
  id: string;
  configSchema: TSchema;
  defaultConfig: z.output<TSchema>;
  /** Растёт при несовместимых изменениях схемы; старые конфиги проходят через `migrateConfig`. */
  configVersion: number;
  migrateConfig?: (raw: unknown, fromVersion: number) => unknown;
  enabledByDefault?: boolean;
  /** Служебный модуль: нельзя выключить. */
  alwaysEnabled?: boolean;
  locales?: Partial<Record<Locale, Dictionary>>;
  bot?: BotFacet<z.output<TSchema>>;
  /**
   * Проверка ссылок конфига на каналы и роли гильдии — API вызывает её перед сохранением.
   * Схема уже проверена; удобно собирать ошибки через `EntityChecker`.
   */
  validateConfig?: (config: z.output<TSchema>, guild: GuildEntities) => ConfigIssue[];
  /**
   * Роуты модуля в API, монтируются в `/v1/guilds/:guildId/modules/<id>`.
   * Доступ к гильдии уже проверен; `request.params.guildId` — ID гильдии.
   */
  api?: (app: FastifyInstance, ctx: ApiModuleContext<z.output<TSchema>>) => Promise<void> | void;
  /**
   * Публичные роуты без авторизации: `/v1/public/guilds/:guildId/modules/<id>`.
   * Отвечают, только если модуль включён в гильдии (проверяет API).
   */
  publicApi?: (app: FastifyInstance, ctx: ModuleServices<z.output<TSchema>>) => Promise<void> | void;
  /** Отложенные задачи: тип `<moduleId>:<имя>`, планируются через `ctx.scheduler`, выполняет воркер. */
  jobs?: Record<string, JobHandler<z.output<TSchema>>>;
  /** Периодические задачи воркера (флаш счётчиков, поллинг источников). */
  intervals?: Record<string, IntervalTask<z.output<TSchema>>>;
}

/** Обработчик задачи; `payload` модуль валидирует сам. Ошибка — повтор с задержкой. */
export type JobHandler<TConfig = unknown> = (payload: unknown, ctx: JobContext<TConfig>) => Promise<void>;

export interface IntervalTask<TConfig = unknown> {
  everyMs: number;
  run(ctx: ModuleServices<TConfig>): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- реестр хранит модули с разными схемами
export type AnyModule = ModuleDefinition<any>;

export function defineModule<TSchema extends z.ZodType>(module: ModuleDefinition<TSchema>): ModuleDefinition<TSchema> {
  return module;
}

export function defineCommand<TConfig = unknown>(command: SlashCommand<TConfig>): SlashCommand<TConfig> {
  return command;
}

export function defineComponent<TConfig = unknown>(handler: ComponentHandler<TConfig>): ComponentHandler<TConfig> {
  return handler;
}
