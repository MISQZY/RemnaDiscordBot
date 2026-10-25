import type { VipFeature, VipState } from '@bot/contracts';
import type { z } from 'zod';
import type { Logger } from '@bot/logger';
import type { Redis } from 'ioredis';
import { RedisChannels } from '../redis-keys.js';
import type { VipStore } from './store.js';

/** How often a process rereads VIP on its own, in case a change message was missed. */
const REFRESH_MS = 60_000;

/**
 * Which modules need VIP and which guilds have it — set by an external dashboard (`PUT /v1/vip`). The whole state is
 * small and kept in memory of every process; expiry is checked on each read, so VIP ends on time without a message.
 */
export class VipAccess {
  private modules = new Set<string>();
  private features = new Set<VipFeature>();
  /** Guild → end of VIP in ms; Infinity — forever. */
  private guilds = new Map<string, number>();

  constructor(private readonly store?: VipStore) {}

  set(state: z.input<typeof VipState>): void {
    this.modules = new Set(state.modules);
    this.features = new Set(state.features);
    this.guilds = new Map(state.guilds.map((g) => [g.guildId, g.expiresAt ? Date.parse(g.expiresAt) : Infinity]));
  }

  isVipModule(moduleId: string): boolean {
    return this.modules.has(moduleId);
  }

  /** The guild's VIP while active: `expiresAt: null` — forever; `null` — no VIP. */
  of(guildId: string, now = Date.now()): { expiresAt: string | null } | null {
    const end = this.guilds.get(guildId);
    if (end === undefined || end <= now) return null;
    return { expiresAt: end === Infinity ? null : new Date(end).toISOString() };
  }

  /** The module needs VIP the guild does not have: it works as disabled, its stored state kept. */
  locked(guildId: string, moduleId: string, now = Date.now()): boolean {
    return this.isVipModule(moduleId) && this.of(guildId, now) === null;
  }

  /** The feature needs VIP the guild does not have. */
  featureLocked(guildId: string, feature: VipFeature, now = Date.now()): boolean {
    return this.features.has(feature) && this.of(guildId, now) === null;
  }

  async refresh(): Promise<void> {
    if (this.store) this.set(await this.store.load());
  }

  /** Loads the state, then follows changes from other processes and rereads it every minute. */
  async start(redis: Redis, logger: Logger): Promise<() => Promise<void>> {
    await this.refresh();
    const reload = () => void this.refresh().catch((err: unknown) => logger.warn({ err }, 'VIP state reload failed'));
    const timer = setInterval(reload, REFRESH_MS);
    timer.unref();

    const subscriber = redis.duplicate();
    subscriber.on('error', (err) => logger.error({ err }, 'Redis subscriber error'));
    subscriber.on('message', (channel: string) => {
      if (channel === RedisChannels.vipChanged) reload();
    });
    await subscriber.subscribe(RedisChannels.vipChanged);

    return async () => {
      clearInterval(timer);
      await subscriber.unsubscribe(RedisChannels.vipChanged);
      subscriber.disconnect();
    };
  }
}

export async function publishVipChanged(redis: Redis): Promise<void> {
  await redis.publish(RedisChannels.vipChanged, '1');
}
