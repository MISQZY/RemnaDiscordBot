import { ModuleId } from '@bot/contracts';
import type { I18n } from '@bot/i18n';
import type { ClientEvents, GatewayIntentBits, Partials } from 'discord.js';
import { CORE_NAMESPACE } from './locales.js';
import type { AnyModule, ComponentHandler, EventHandlers, FallbackCommand, JobHandler, SlashCommand } from './module.js';

export interface Registered<T> {
  module: AnyModule;
  item: T;
}

type AnyEventHandler = NonNullable<EventHandlers<unknown>[keyof ClientEvents]>;

export class ModuleRegistry {
  private readonly modules = new Map<string, AnyModule>();
  private readonly commands = new Map<string, Registered<SlashCommand>>();
  private readonly components = new Map<string, Registered<ComponentHandler>>();
  private readonly events = new Map<keyof ClientEvents, Registered<AnyEventHandler>[]>();
  private fallback: Registered<FallbackCommand> | undefined;

  constructor(modules: AnyModule[] = []) {
    for (const module of modules) this.register(module);
  }

  register(module: AnyModule): this {
    const id = ModuleId.safeParse(module.id);
    if (!id.success) throw new Error(`Invalid module id "${module.id}"`);
    if (module.id === CORE_NAMESPACE) throw new Error(`Module id "${CORE_NAMESPACE}" is reserved`);
    if (this.modules.has(module.id)) throw new Error(`Module "${module.id}" is already registered`);

    const defaults = module.configSchema.safeParse(module.defaultConfig);
    if (!defaults.success) {
      throw new Error(`Module "${module.id}" has invalid defaultConfig: ${defaults.error.message}`);
    }

    for (const command of module.bot?.commands ?? []) {
      const owner = this.commands.get(command.data.name);
      if (owner) throw new Error(`Command "/${command.data.name}" is already registered by "${owner.module.id}"`);
    }
    for (const prefix of Object.keys(module.bot?.components ?? {})) {
      const owner = this.components.get(prefix);
      if (owner) throw new Error(`Component prefix "${prefix}" is already registered by "${owner.module.id}"`);
    }

    if (module.bot?.fallbackCommand && this.fallback) {
      throw new Error(`Fallback command is already registered by "${this.fallback.module.id}"`);
    }

    this.modules.set(module.id, module);
    if (module.bot?.fallbackCommand) this.fallback = { module, item: module.bot.fallbackCommand };
    for (const command of module.bot?.commands ?? []) {
      this.commands.set(command.data.name, { module, item: command });
    }
    for (const [prefix, handler] of Object.entries(module.bot?.components ?? {})) {
      this.components.set(prefix, { module, item: handler });
    }
    for (const [event, handler] of Object.entries(module.bot?.events ?? {})) {
      const name = event as keyof ClientEvents;
      const list = this.events.get(name) ?? [];
      list.push({ module, item: handler as AnyEventHandler });
      this.events.set(name, list);
    }
    return this;
  }

  /** Обработчик задачи по типу `<moduleId>:<job>`. */
  findJob(type: string): Registered<JobHandler> | undefined {
    const separator = type.indexOf(':');
    const module = this.modules.get(type.slice(0, separator));
    const handler = separator > 0 ? module?.jobs?.[type.slice(separator + 1)] : undefined;
    return module && handler ? { module, item: handler } : undefined;
  }

  get(id: string): AnyModule | undefined {
    return this.modules.get(id);
  }

  all(): AnyModule[] {
    return [...this.modules.values()];
  }

  allCommands(): Registered<SlashCommand>[] {
    return [...this.commands.values()];
  }

  findCommand(name: string): Registered<SlashCommand> | undefined {
    return this.commands.get(name);
  }

  /** Обработчик команд, которых нет в реестре. */
  fallbackCommand(): Registered<FallbackCommand> | undefined {
    return this.fallback;
  }

  /** Ищет обработчик по префиксу `customId`: `lvl:page:2` → `lvl`. */
  findComponent(customId: string): Registered<ComponentHandler> | undefined {
    return this.components.get(customId.split(':', 1)[0]!);
  }

  subscribedEvents(): (keyof ClientEvents)[] {
    return [...this.events.keys()];
  }

  subscribers(event: keyof ClientEvents): Registered<AnyEventHandler>[] {
    return this.events.get(event) ?? [];
  }

  /** Объединение intents всех модулей и базовых, нужных самому боту. */
  intents(base: readonly GatewayIntentBits[] = []): GatewayIntentBits[] {
    const all = new Set(base);
    for (const module of this.modules.values()) {
      for (const intent of module.bot?.intents ?? []) all.add(intent);
    }
    return [...all];
  }

  /** Объединение partials всех модулей. */
  partials(): Partials[] {
    return [...new Set(this.all().flatMap((module) => module.bot?.partials ?? []))];
  }

  /** Регистрирует словари модулей в i18n под неймспейсом `<moduleId>`. */
  registerLocales(i18n: I18n): void {
    for (const module of this.modules.values()) {
      if (module.locales) i18n.register(module.id, module.locales);
    }
  }
}
