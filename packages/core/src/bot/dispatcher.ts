import type { EventEmitter } from 'node:events';
import {
  Events,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ClientEvents,
  type Interaction,
  type InteractionReplyOptions,
  type Locale as DiscordLocale,
} from 'discord.js';
import type { BotModuleContext, BotServices } from '../context.js';
import { metrics } from '../metrics.js';
import type { AnyModule, InteractionContext, SlashCommand } from '../module.js';
import { RedisKeys } from '../redis-keys.js';
import type { ModuleRegistry } from '../registry.js';
import { extractGuildId } from './guild-id.js';

export interface DispatcherOptions {
  /** How long to wait for an event handler before reporting it as stuck. */
  handlerTimeoutMs?: number;
}

type LooseEventHandler = (ctx: BotModuleContext<unknown>, ...args: unknown[]) => unknown;

class HandlerTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HandlerTimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The single entry point for Discord events: dispatches them to modules,
 * skipping modules disabled in the guild, and isolates handler errors.
 */
export class Dispatcher {
  private readonly contexts = new Map<string, BotModuleContext<unknown>>();

  constructor(
    private readonly services: BotServices,
    private readonly registry: ModuleRegistry,
    private readonly options: DispatcherOptions = {},
  ) {}

  attach(): void {
    const emitter = this.services.client as unknown as EventEmitter;
    for (const event of this.registry.subscribedEvents()) {
      emitter.on(event, (...args: unknown[]) => void this.dispatchEvent(event, args));
    }
    this.services.client.on(Events.InteractionCreate, (interaction) => void this.handleInteraction(interaction));
  }

  /** Runs modules' `bot.setup`; the returned function tears them down in reverse order. */
  async setupModules(): Promise<() => Promise<void>> {
    const teardowns: (() => unknown)[] = [];
    for (const module of this.registry.all()) {
      const teardown = await module.bot?.setup?.(this.moduleContext(module));
      if (typeof teardown === 'function') teardowns.push(teardown);
    }
    return async () => {
      for (const teardown of teardowns.reverse()) {
        try {
          await teardown();
        } catch (err) {
          this.services.logger.error({ err }, 'Module teardown failed');
        }
      }
    };
  }

  async dispatchEvent(event: keyof ClientEvents, args: readonly unknown[]): Promise<void> {
    const guildId = extractGuildId(args);
    const timeoutMs = this.options.handlerTimeoutMs ?? 10_000;

    await Promise.all(
      this.registry.subscribers(event).map(async ({ module, item }) => {
        try {
          if (guildId && !(await this.services.config.isEnabled(guildId, module.id))) return;
          const handler = item as LooseEventHandler;
          metrics.events.inc({ event, module: module.id });
          await withTimeout(Promise.resolve(handler(this.moduleContext(module), ...args)), timeoutMs, `${module.id}:${event}`);
        } catch (err) {
          metrics.handlerErrors.inc({ module: module.id, handler: `event:${event}` });
          this.services.logger.error({ err, moduleId: module.id, event, guildId }, 'Event handler failed');
        }
      }),
    );
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
        const entry = this.registry.findCommand(interaction.commandName);
        if (!entry) {
          if (interaction.isChatInputCommand()) await this.runFallback(interaction);
          return;
        }
        const ctx = await this.interactionContext(entry.module, interaction);

        if (interaction.isAutocomplete()) {
          if (await this.isEnabledFor(entry.module, interaction.guildId)) await entry.item.autocomplete?.(interaction, ctx);
          else await interaction.respond([]);
          return;
        }

        if (!(await this.isEnabledFor(entry.module, interaction.guildId))) {
          await interaction.reply(this.ephemeral(ctx.t(`core.moduleDisabled`, { module: this.moduleName(entry.module, ctx), id: entry.module.id })));
          return;
        }

        const retryAfterMs = await this.acquireCooldown(entry.item, interaction.user.id);
        if (retryAfterMs > 0) {
          await interaction.reply(this.ephemeral(ctx.t('core.cooldown', { seconds: Math.ceil(retryAfterMs / 1000) })));
          return;
        }

        await this.timeCommand(entry.module, interaction.commandName, () => entry.item.execute(interaction, ctx));
        return;
      }

      if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const entry = this.registry.findComponent(interaction.customId);
        if (!entry) return;
        const ctx = await this.interactionContext(entry.module, interaction);

        if (!(await this.isEnabledFor(entry.module, interaction.guildId))) {
          await interaction.reply(this.ephemeral(ctx.t('core.moduleDisabled', { module: this.moduleName(entry.module, ctx), id: entry.module.id })));
          return;
        }
        try {
          await entry.item.handle(interaction, ctx);
        } catch (err) {
          metrics.handlerErrors.inc({ module: entry.module.id, handler: 'component' });
          throw err;
        }
      }
    } catch (err) {
      this.services.logger.error({ err, interactionId: interaction.id, guildId: interaction.guildId }, 'Interaction failed');
      await this.replyWithError(interaction);
    }
  }

  /** A command not in the registry — hand it to the module with `fallbackCommand` (if enabled in the guild). */
  private async runFallback(interaction: ChatInputCommandInteraction): Promise<void> {
    const fallback = this.registry.fallbackCommand();
    if (!fallback || !(await this.isEnabledFor(fallback.module, interaction.guildId))) return;
    const ctx = await this.interactionContext(fallback.module, interaction);
    await this.timeCommand(fallback.module, 'fallback', () => fallback.item.execute(interaction, ctx));
  }

  /** Records the command duration and counts its failure against the module. */
  private async timeCommand(module: AnyModule, command: string, execute: () => unknown): Promise<void> {
    const end = metrics.commandDuration.startTimer({ command });
    try {
      await execute();
      end({ status: 'ok' });
    } catch (err) {
      end({ status: 'error' });
      metrics.handlerErrors.inc({ module: module.id, handler: `command:${command}` });
      throw err;
    }
  }

  private async isEnabledFor(module: AnyModule, guildId: string | null): Promise<boolean> {
    if (!guildId) return true;
    return this.services.config.isEnabled(guildId, module.id);
  }

  /** Returns 0 when the cooldown was taken, otherwise how many milliseconds to wait. */
  private async acquireCooldown(command: SlashCommand, userId: string): Promise<number> {
    if (!command.cooldownMs) return 0;
    const key = RedisKeys.cooldown(command.data.name, userId);
    const acquired = await this.services.redis.set(key, '1', 'PX', command.cooldownMs, 'NX');
    if (acquired) return 0;
    return Math.max(await this.services.redis.pttl(key), 1);
  }

  private async replyWithError(interaction: Interaction): Promise<void> {
    if (!interaction.isRepliable()) return;
    const locale = this.services.i18n.resolveLocale(interaction.locale);
    const options = this.ephemeral(this.services.i18n.t(locale, 'core.error'));
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(options);
      else await interaction.reply(options);
    } catch (err) {
      this.services.logger.warn({ err, interactionId: interaction.id }, 'Failed to report interaction error');
    }
  }

  private ephemeral(content: string): InteractionReplyOptions & { flags: MessageFlags.Ephemeral } {
    return { content, flags: MessageFlags.Ephemeral };
  }

  private moduleName(module: AnyModule, ctx: InteractionContext<unknown>): string {
    const key = `${module.id}.name`;
    return this.services.i18n.has(key, ctx.locale) ? ctx.t(key) : module.id;
  }

  private moduleContext(module: AnyModule): BotModuleContext<unknown> {
    let ctx = this.contexts.get(module.id);
    if (!ctx) {
      ctx = {
        ...this.services,
        logger: this.services.logger.child({ moduleId: module.id }),
        moduleId: module.id,
        getConfig: async (guildId) => (await this.services.config.get(guildId, module.id)).config,
      };
      this.contexts.set(module.id, ctx);
    }
    return ctx;
  }

  /** The user's language for private replies, the server's language for what everyone sees. */
  private async interactionContext(
    module: AnyModule,
    { locale: discordLocale, guildId }: { locale: DiscordLocale | string; guildId: string | null },
  ): Promise<InteractionContext<unknown>> {
    const { i18n, guildLocales } = this.services;
    const locale = i18n.resolveLocale(discordLocale);
    const guildLocale = guildId ? await guildLocales.get(guildId) : locale;
    return {
      ...this.moduleContext(module),
      locale,
      guildLocale,
      t: (key, vars) => i18n.t(locale, key, vars),
      tGuild: (key, vars) => i18n.t(guildLocale, key, vars),
    };
  }
}
