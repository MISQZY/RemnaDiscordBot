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

/** Interaction context: module context plus the user's and the server's language. */
export interface InteractionContext<TConfig> extends BotModuleContext<TConfig> {
  /** The user's language — for ephemeral replies. */
  locale: Locale;
  /** The server's language — for messages everyone sees. */
  guildLocale: Locale;
  t(key: string, vars?: Record<string, string | number>): string;
  tGuild(key: string, vars?: Record<string, string | number>): string;
}

export interface SlashCommand<TConfig = unknown> {
  /** A `SlashCommandBuilder` or any object with the same contract. */
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  cooldownMs?: number;
  execute(interaction: ChatInputCommandInteraction, ctx: InteractionContext<TConfig>): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: InteractionContext<TConfig>): Promise<void>;
}

export interface FallbackCommand<TConfig = unknown> {
  execute(interaction: ChatInputCommandInteraction, ctx: InteractionContext<TConfig>): Promise<void>;
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
  /** Gateway intents the module needs; the bot connects with their union. */
  intents?: GatewayIntentBits[];
  /** discord.js partials — events for uncached objects (deleting old messages, etc.). */
  partials?: Partials[];
  commands?: SlashCommand<TConfig>[];
  events?: EventHandlers<TConfig>;
  /** Component handlers by `customId` prefix (the part before the first `:`). */
  components?: Record<string, ComponentHandler<TConfig>>;
  /**
   * Handler for slash commands that are not in the registry (dynamic guild commands).
   * Only one module may have such a handler.
   */
  fallbackCommand?: FallbackCommand<TConfig>;
}

export interface ModuleDefinition<TSchema extends z.ZodType = z.ZodType> {
  /** Stable identifier: used in the database, URLs and cache keys. */
  id: string;
  configSchema: TSchema;
  defaultConfig: z.output<TSchema>;
  /** Bumped on incompatible schema changes; older configs go through `migrateConfig`. */
  configVersion: number;
  migrateConfig?: (raw: unknown, fromVersion: number) => unknown;
  /**
   * Default config texts in the guild's language: `t('defaults.joinMessage')` takes the string
   * `<moduleId>.defaults.joinMessage` from the module's dictionaries as is (a template, not ICU). Called for guilds without a saved config.
   */
  localizeDefaults?: (defaults: z.output<TSchema>, t: (key: string) => string) => z.output<TSchema>;
  enabledByDefault?: boolean;
  /** Built-in module: cannot be disabled. */
  alwaysEnabled?: boolean;
  locales?: Partial<Record<Locale, Dictionary>>;
  bot?: BotFacet<z.output<TSchema>>;
  /**
   * Checks the config's references to guild channels and roles — the API calls it before saving.
   * The schema is already validated; `EntityChecker` is handy for collecting issues.
   */
  validateConfig?: (config: z.output<TSchema>, guild: GuildEntities) => ConfigIssue[];
  /**
   * The module's API routes, mounted at `/v1/guilds/:guildId/modules/<id>`.
   * Guild access is already checked; `request.params.guildId` is the guild ID.
   */
  api?: (app: FastifyInstance, ctx: ApiModuleContext<z.output<TSchema>>) => Promise<void> | void;
  /**
   * Public routes without auth: `/v1/public/guilds/:guildId/modules/<id>`.
   * They respond only when the module is enabled in the guild (checked by the API).
   */
  publicApi?: (app: FastifyInstance, ctx: ModuleServices<z.output<TSchema>>) => Promise<void> | void;
  /** Scheduled jobs: type `<moduleId>:<name>`, scheduled via `ctx.scheduler`, run by the worker. */
  jobs?: Record<string, JobHandler<z.output<TSchema>>>;
  /** Worker interval tasks (flushing counters, polling sources). */
  intervals?: Record<string, IntervalTask<z.output<TSchema>>>;
}

/** Job handler; the module validates `payload` itself. An error means a delayed retry. */
export type JobHandler<TConfig = unknown> = (payload: unknown, ctx: JobContext<TConfig>) => Promise<void>;

export interface IntervalTask<TConfig = unknown> {
  everyMs: number;
  run(ctx: ModuleServices<TConfig>): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry stores modules with different schemas
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
