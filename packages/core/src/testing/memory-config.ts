import type { SharedConfigCache } from '../config/shared-cache.js';
import { ConfigConflictError, type ConfigStore, type ConfigWrite, type StoredConfig } from '../config/store.js';

export class MemoryConfigStore implements ConfigStore {
  readonly rows = new Map<string, StoredConfig>();
  finds = 0;

  async find(guildId: string, moduleId: string): Promise<StoredConfig | null> {
    this.finds++;
    return this.rows.get(`${guildId}:${moduleId}`) ?? null;
  }

  async save(guildId: string, moduleId: string, value: ConfigWrite, _updatedBy?: string, expectedUpdatedAt?: string | null): Promise<StoredConfig> {
    const previous = this.rows.get(`${guildId}:${moduleId}`);
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== (previous?.updatedAt ?? null)) throw new ConfigConflictError();
    const stored = { ...value, updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString() };
    this.rows.set(`${guildId}:${moduleId}`, stored);
    return stored;
  }
}

export class MemorySharedCache implements SharedConfigCache {
  readonly entries = new Map<string, StoredConfig | null>();

  async get(guildId: string, moduleId: string): Promise<StoredConfig | null | undefined> {
    const key = `${guildId}:${moduleId}`;
    return this.entries.has(key) ? this.entries.get(key) : undefined;
  }

  async set(guildId: string, moduleId: string, value: StoredConfig | null): Promise<void> {
    this.entries.set(`${guildId}:${moduleId}`, value);
  }

  async delete(guildId: string, moduleId: string): Promise<void> {
    this.entries.delete(`${guildId}:${moduleId}`);
  }
}
