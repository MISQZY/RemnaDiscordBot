import type { Redis } from 'ioredis';
import { RedisKeys } from '../redis-keys.js';
import type { StoredConfig } from './store.js';

/** Cache shared by all processes and clusters. `null` — no row in the database. */
export interface SharedConfigCache {
  get(guildId: string, moduleId: string): Promise<StoredConfig | null | undefined>;
  getMany?(guildId: string, moduleIds: string[]): Promise<Map<string, StoredConfig | null>>;
  set(guildId: string, moduleId: string, value: StoredConfig | null): Promise<void>;
  setMany?(guildId: string, entries: Map<string, StoredConfig | null>): Promise<void>;
  delete(guildId: string, moduleId: string): Promise<void>;
}

const NONE = 'none';

export class RedisConfigCache implements SharedConfigCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 600,
  ) {}

  async get(guildId: string, moduleId: string): Promise<StoredConfig | null | undefined> {
    const raw = await this.redis.get(RedisKeys.moduleConfig(guildId, moduleId));
    if (raw === null) return undefined;
    return raw === NONE ? null : (JSON.parse(raw) as StoredConfig);
  }

  async getMany(guildId: string, moduleIds: string[]): Promise<Map<string, StoredConfig | null>> {
    if (moduleIds.length === 0) return new Map();
    const keys = moduleIds.map((m) => RedisKeys.moduleConfig(guildId, m));
    const rawList = await this.redis.mget(keys);
    const result = new Map<string, StoredConfig | null>();
    for (let i = 0; i < moduleIds.length; i++) {
      const moduleId = moduleIds[i];
      if (!moduleId) continue;
      const raw = rawList[i];
      if (raw !== null && raw !== undefined) {
        result.set(moduleId, raw === NONE ? null : (JSON.parse(raw) as StoredConfig));
      }
    }
    return result;
  }

  async set(guildId: string, moduleId: string, value: StoredConfig | null): Promise<void> {
    const raw = value === null ? NONE : JSON.stringify(value);
    await this.redis.set(RedisKeys.moduleConfig(guildId, moduleId), raw, 'EX', this.ttlSec);
  }

  async setMany(guildId: string, entries: Map<string, StoredConfig | null>): Promise<void> {
    if (entries.size === 0) return;
    const pipeline = this.redis.pipeline();
    for (const [moduleId, value] of entries) {
      const raw = value === null ? NONE : JSON.stringify(value);
      pipeline.set(RedisKeys.moduleConfig(guildId, moduleId), raw, 'EX', this.ttlSec);
    }
    await pipeline.exec();
  }

  async delete(guildId: string, moduleId: string): Promise<void> {
    await this.redis.del(RedisKeys.moduleConfig(guildId, moduleId));
  }
}
