import type { ConfigInvalidation, Locale } from '@bot/contracts';
import type { I18n } from '@bot/i18n';
import type { Logger } from '@bot/logger';
import { LRUCache } from 'lru-cache';
import { HttpError } from '../http-error.js';
import type { AnyModule } from '../module.js';
import type { ModuleRegistry } from '../registry.js';
import { VipAccess } from '../vip/access.js';
import type { SharedConfigCache } from './shared-cache.js';
import type { ConfigStore, StoredConfig } from './store.js';

export interface ResolvedConfig<T = unknown> {
  enabled: boolean;
  config: T;
  /** `null` — the config was never saved, defaults apply. */
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
  /** Broadcasts invalidation to other processes after a write. */
  publish?: (message: ConfigInvalidation) => Promise<void>;
  /** Guild language and dictionaries — for localized defaults (`localizeDefaults`). */
  locales?: { localeOf(guildId: string): Promise<Locale>; i18n: I18n };
  /** Which modules need VIP and which guilds have it; without it no module needs VIP. */
  vip?: VipAccess;
  localTtlMs?: number;
  localMax?: number;
}

export class UnknownModuleError extends Error {
  constructor(readonly moduleId: string) {
    super(`Unknown module "${moduleId}"`);
  }
}

/**
 * Module configs per guild. Reads: process LRU → shared cache (Redis) → database → defaultConfig.
 * Writes validate the config with the module's schema and invalidate caches in all processes.
 * A VIP module in a guild without VIP reads as disabled; what is stored stays, and works again once VIP is back.
 */
export class ConfigService {
  readonly vip: VipAccess;
  private readonly local: LRUCache<string, ResolvedConfig>;
  /** Loads under way: a burst of events of one guild waits for one read of Redis or the database, not one each. */
  private readonly loading = new Map<string, Promise<ResolvedConfig>>();
  /** Moves on every invalidation: a load that started before one must not put the old config back in the cache. */
  private generation = 0;

  constructor(private readonly options: ConfigServiceOptions) {
    // Guilds × modules that see events: a cluster of four busy shards needs tens of thousands.
    this.local = new LRUCache({ max: options.localMax ?? 100_000, ttl: options.localTtlMs ?? 5 * 60_000 });
    this.vip = options.vip ?? new VipAccess();
  }

  async get<T = unknown>(guildId: string, moduleId: string): Promise<ResolvedConfig<T>> {
    const resolved = await this.stored<T>(guildId, moduleId);
    return resolved.enabled && this.vip.locked(guildId, moduleId) ? { ...resolved, enabled: false } : resolved;
  }

  /** The module is off only for want of VIP. */
  vipLocked(guildId: string, moduleId: string): boolean {
    return this.vip.locked(guildId, moduleId);
  }

  /** The config as saved, VIP aside — what the cache keeps, since VIP runs out by the clock. */
  private async stored<T = unknown>(guildId: string, moduleId: string): Promise<ResolvedConfig<T>> {
    const key = `${guildId}:${moduleId}`;
    const cached = this.local.get(key);
    if (cached) return cached as ResolvedConfig<T>;

    const generation = this.generation;
    let pending = this.loading.get(key);
    if (!pending) {
      const module = this.requireModule(moduleId);
      pending = (async () => this.resolve(module, guildId, await this.load(guildId, moduleId)))().finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }
    const resolved = await pending;
    if (generation === this.generation) this.local.set(key, resolved);
    return resolved as ResolvedConfig<T>;
  }

  async isEnabled(guildId: string, moduleId: string): Promise<boolean> {
    return (await this.get(guildId, moduleId)).enabled;
  }

  async getAll(guildId: string): Promise<Map<string, ResolvedConfig>> {
    const modules = this.options.registry.all();
    const result = new Map<string, ResolvedConfig>();
    const missingModuleIds: string[] = [];

    for (const module of modules) {
      const key = `${guildId}:${module.id}`;
      const cached = this.local.get(key);
      if (cached) {
        result.set(module.id, cached);
      } else {
        missingModuleIds.push(module.id);
      }
    }

    if (missingModuleIds.length > 0) {
      const fromShared = this.options.sharedCache?.getMany
        ? await this.options.sharedCache.getMany(guildId, missingModuleIds)
        : new Map<string, StoredConfig | null>();

      const stillMissingIds = missingModuleIds.filter((id) => !fromShared.has(id));
      let fromStore = new Map<string, StoredConfig>();
      if (stillMissingIds.length > 0) {
        if (this.options.store.findMany) {
          fromStore = await this.options.store.findMany(guildId, stillMissingIds);
        } else {
          await Promise.all(
            stillMissingIds.map(async (id) => {
              const item = await this.options.store.find(guildId, id);
              if (item) fromStore.set(id, item);
            }),
          );
        }

        const toCacheInShared = new Map<string, StoredConfig | null>();
        for (const id of stillMissingIds) {
          const stored = fromStore.get(id) ?? null;
          toCacheInShared.set(id, stored);
          fromShared.set(id, stored);
        }
        if (this.options.sharedCache?.setMany) {
          await this.options.sharedCache.setMany(guildId, toCacheInShared);
        } else if (this.options.sharedCache) {
          await Promise.all(
            [...toCacheInShared.entries()].map(([id, val]) => this.options.sharedCache!.set(guildId, id, val)),
          );
        }
      }

      const generation = this.generation;
      for (const id of missingModuleIds) {
        const module = this.requireModule(id);
        const stored = fromShared.get(id) ?? fromStore.get(id) ?? null;
        const resolved = await this.resolve(module, guildId, stored);
        if (generation === this.generation) {
          this.local.set(`${guildId}:${id}`, resolved);
        }
        result.set(id, resolved);
      }
    }

    const finalResult = new Map<string, ResolvedConfig>();
    for (const [id, resolved] of result.entries()) {
      finalResult.set(
        id,
        resolved.enabled && this.vip.locked(guildId, id) ? { ...resolved, enabled: false } : resolved,
      );
    }
    return finalResult;
  }

  async enabledModules(guildId: string): Promise<string[]> {
    const all = await this.getAll(guildId);
    return this.options.registry.all().filter((m) => all.get(m.id)?.enabled).map((m) => m.id);
  }

  async update<T = unknown>(
    guildId: string,
    moduleId: string,
    patch: ConfigPatch,
    updatedBy?: string,
    expectedUpdatedAt?: string | null,
  ): Promise<ResolvedConfig<T>> {
    const module = this.requireModule(moduleId);
    // Saving the config of a module locked for want of VIP keeps it on for when VIP is back.
    const current = await this.stored(guildId, moduleId);
    if (patch.enabled === true && this.vip.locked(guildId, moduleId)) throw HttpError.vipRequired(moduleId);

    const config = module.configSchema.parse(patch.config ?? current.config);
    const enabled = module.alwaysEnabled ? true : (patch.enabled ?? current.enabled);

    const saved = await this.options.store.save(
      guildId,
      moduleId,
      { enabled, config, version: module.configVersion },
      updatedBy,
      expectedUpdatedAt === undefined ? current.updatedAt : expectedUpdatedAt,
    );
    await this.options.sharedCache?.delete(guildId, moduleId);
    this.invalidate({ guildId, moduleId });
    await this.options.publish?.({ guildId, moduleId });

    return { enabled: enabled && !this.vip.locked(guildId, moduleId), config: config as T, updatedAt: saved.updatedAt };
  }

  /** Drops the local cache — called on a pub/sub message. */
  invalidate({ guildId, moduleId }: ConfigInvalidation): void {
    this.generation++;
    for (const key of this.loading.keys()) if (key === `${guildId}:${moduleId}` || (!moduleId && key.startsWith(`${guildId}:`))) this.loading.delete(key);
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

  /** Default config; its texts are in the guild's language when the module localizes them. */
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
