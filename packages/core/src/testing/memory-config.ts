import type { SharedConfigCache } from '../config/shared-cache.js';
import { ConfigConflictError, type ConfigStore, type ConfigWrite, type StoredConfig } from '../config/store.js';

export class MemoryConfigStore implements ConfigStore {
  readonly rows = new Map<string, StoredConfig>();
  finds = 0;

  async find(guildId: string, moduleId: string): Promise<StoredConfig | null> {
    this.finds++;
    return this.rows.get(`${guildId}:${moduleId}`) ?? null;
  }

  async findMany(guildId: string, moduleIds?: string[]): Promise<Map<string, StoredConfig>> {
    this.finds++;
    const result = new Map<string, StoredConfig>();
    for (const [key, val] of this.rows.entries()) {
      const [g, m] = key.split(':');
      if (g === guildId && m && (!moduleIds || moduleIds.includes(m))) {
        result.set(m, val);
      }
    }
    return result;
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

  async getMany(guildId: string, moduleIds: string[]): Promise<Map<string, StoredConfig | null>> {
    const result = new Map<string, StoredConfig | null>();
    for (const m of moduleIds) {
      const key = `${guildId}:${m}`;
      if (this.entries.has(key)) {
        result.set(m, this.entries.get(key)!);
      }
    }
    return result;
  }

  async set(guildId: string, moduleId: string, value: StoredConfig | null): Promise<void> {
    this.entries.set(`${guildId}:${moduleId}`, value);
  }

  async setMany(guildId: string, entries: Map<string, StoredConfig | null>): Promise<void> {
    for (const [m, val] of entries) {
      this.entries.set(`${guildId}:${m}`, val);
    }
  }

  async delete(guildId: string, moduleId: string): Promise<void> {
    this.entries.delete(`${guildId}:${moduleId}`);
  }
}
