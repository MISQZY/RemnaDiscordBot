import type { Redis } from 'ioredis';
import { RedisKeys } from '../redis-keys.js';
import type { StoredConfig } from './store.js';

/** Кэш, общий для всех процессов и кластеров. `null` — в БД записи нет. */
export interface SharedConfigCache {
  get(guildId: string, moduleId: string): Promise<StoredConfig | null | undefined>;
  set(guildId: string, moduleId: string, value: StoredConfig | null): Promise<void>;
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

  async set(guildId: string, moduleId: string, value: StoredConfig | null): Promise<void> {
    const raw = value === null ? NONE : JSON.stringify(value);
    await this.redis.set(RedisKeys.moduleConfig(guildId, moduleId), raw, 'EX', this.ttlSec);
  }

  async delete(guildId: string, moduleId: string): Promise<void> {
    await this.redis.del(RedisKeys.moduleConfig(guildId, moduleId));
  }
}
