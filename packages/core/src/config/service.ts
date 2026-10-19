import type { ConfigInvalidation, Locale } from '@bot/contracts';
import type { I18n } from '@bot/i18n';
import type { Logger } from '@bot/logger';
import { LRUCache } from 'lru-cache';
import type { AnyModule } from '../module.js';
import type { ModuleRegistry } from '../registry.js';
import type { SharedConfigCache } from './shared-cache.js';
import type { ConfigStore, StoredConfig } from './store.js';

export interface ResolvedConfig<T = unknown> {
  enabled: boolean;
  config: T;
  /** `null` — конфиг не сохранялся, действуют значения по умолчанию. */
  updatedAt: string | null;
}

export interface ConfigPatch {
  enabled?: boolean;
  config?: unknown;
}

export interface ConfigServiceOptions {
  registry: ModuleRegistry;
  store: ConfigStore;
  logger: Logger;
  sharedCache?: SharedConfigCache;
  /** Рассылка инвалидации другим процессам после записи. */
  publish?: (message: ConfigInvalidation) => Promise<void>;
  /** Язык гильдии и словари — для локализованных значений по умолчанию (`localizeDefaults`). */
  locales?: { localeOf(guildId: string): Promise<Locale>; i18n: I18n };
  localTtlMs?: number;
  localMax?: number;
}

export class UnknownModuleError extends Error {
  constructor(readonly moduleId: string) {
    super(`Unknown module "${moduleId}"`);
  }
}

/**
 * Конфиги модулей по гильдиям. Чтение: LRU процесса → общий кэш (Redis) → БД → defaultConfig.
 * Запись валидирует конфиг схемой модуля и инвалидирует кэши во всех процессах.
 */
export class ConfigService {
  private readonly local: LRUCache<string, ResolvedConfig>;

  constructor(private readonly options: ConfigServiceOptions) {
    this.local = new LRUCache({ max: options.localMax ?? 50_000, ttl: options.localTtlMs ?? 5 * 60_000 });
  }

  async get<T = unknown>(guildId: string, moduleId: string): Promise<ResolvedConfig<T>> {
    const key = `${guildId}:${moduleId}`;
    const cached = this.local.get(key);
    if (cached) return cached as ResolvedConfig<T>;

    const module = this.requireModule(moduleId);
    const resolved = await this.resolve(module, guildId, await this.load(guildId, moduleId));
    this.local.set(key, resolved);
    return resolved as ResolvedConfig<T>;
  }

  async isEnabled(guildId: string, moduleId: string): Promise<boolean> {
    return (await this.get(guildId, moduleId)).enabled;
  }

  async enabledModules(guildId: string): Promise<string[]> {
    const modules = this.options.registry.all();
    const flags = await Promise.all(modules.map((m) => this.isEnabled(guildId, m.id)));
    return modules.filter((_, i) => flags[i]).map((m) => m.id);
  }

  async update<T = unknown>(
    guildId: string,
    moduleId: string,
    patch: ConfigPatch,
    updatedBy?: string,
  ): Promise<ResolvedConfig<T>> {
    const module = this.requireModule(moduleId);
    const current = await this.get(guildId, moduleId);

    const config = module.configSchema.parse(patch.config ?? current.config);
    const enabled = module.alwaysEnabled ? true : (patch.enabled ?? current.enabled);

    const saved = await this.options.store.save(
      guildId,
      moduleId,
      { enabled, config, version: module.configVersion },
      updatedBy,
    );
    await this.options.sharedCache?.delete(guildId, moduleId);
    this.invalidate({ guildId, moduleId });
    await this.options.publish?.({ guildId, moduleId });

    return { enabled, config: config as T, updatedAt: saved.updatedAt };
  }

  /** Сбрасывает локальный кэш — вызывается по сообщению из pub/sub. */
  invalidate({ guildId, moduleId }: ConfigInvalidation): void {
    if (moduleId) {
      this.local.delete(`${guildId}:${moduleId}`);
      return;
    }
    for (const key of this.local.keys()) {
      if (key.startsWith(`${guildId}:`)) this.local.delete(key);
    }
  }

  private requireModule(moduleId: string): AnyModule {
    const module = this.options.registry.get(moduleId);
    if (!module) throw new UnknownModuleError(moduleId);
    return module;
  }

  private async load(guildId: string, moduleId: string): Promise<StoredConfig | null> {
    const { sharedCache, store } = this.options;
    const shared = await sharedCache?.get(guildId, moduleId);
    if (shared !== undefined) return shared;

    const stored = await store.find(guildId, moduleId);
    await sharedCache?.set(guildId, moduleId, stored);
    return stored;
  }

  /** Конфиг по умолчанию; тексты в нём — на языке гильдии, если модуль их локализует. */
  async defaults(guildId: string, moduleId: string): Promise<unknown> {
    const module = this.requireModule(moduleId);
    const { locales } = this.options;
    if (!module.localizeDefaults || !locales) return module.defaultConfig;
    const locale = await locales.localeOf(guildId);
    return module.localizeDefaults(structuredClone(module.defaultConfig), (key) => locales.i18n.raw(locale, `${module.id}.${key}`));
  }

  private async resolve(module: AnyModule, guildId: string, stored: StoredConfig | null): Promise<ResolvedConfig> {
    const enabled = module.alwaysEnabled || (stored?.enabled ?? module.enabledByDefault ?? false);
    if (!stored) return { enabled, config: await this.defaults(guildId, module.id), updatedAt: null };

    const raw =
      stored.version < module.configVersion && module.migrateConfig
        ? module.migrateConfig(stored.config, stored.version)
        : stored.config;

    const parsed = module.configSchema.safeParse(raw);
    if (parsed.success) return { enabled, config: parsed.data, updatedAt: stored.updatedAt };

    this.options.logger.warn(
      { guildId, moduleId: module.id, issues: parsed.error.issues },
      'Stored module config is invalid, falling back to defaults',
    );
    return { enabled, config: await this.defaults(guildId, module.id), updatedAt: stored.updatedAt };
  }
}
