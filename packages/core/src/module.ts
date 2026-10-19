import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';
import type {
  AutocompleteInteraction,
  Awaitable,
  ChatInputCommandInteraction,
  ClientEvents,
  GatewayIntentBits,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { z } from 'zod';
import type { BotModuleContext } from './context.js';

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
