import type { BotModuleContext } from '@bot/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onMessage } from './bot.js';
import { defaultLevelingConfig, type LevelingConfig } from './config.js';

function setup() {
  const config = { ...defaultLevelingConfig, xpPerMessage: { min: 1, max: 1 }, cooldownSec: 60 };
  const set = vi.fn(async (): Promise<string | null> => 'OK');
  const upsert = vi.fn(async () => ({ guildId: 'guild', userId: 'user', xp: 1, level: 0, messages: 1 }));
  const ctx = { redis: { set }, db: { memberLevel: { upsert } }, getConfig: async () => config } as unknown as BotModuleContext<LevelingConfig>;
  const message = { inGuild: () => true, guildId: 'guild', channelId: 'channel', author: { id: 'user', bot: false }, member: { roles: { cache: new Map() } } } as never;
  return { ctx, message, config, set, upsert };
}

afterEach(() => vi.useRealTimers());

describe('message XP cooldown fast path', () => {
  it('skips Redis for 100 messages inside a locally acquired cooldown and checks again after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { ctx, message, set, upsert } = setup();
    await onMessage(ctx, message);
    await Promise.all(Array.from({ length: 100 }, () => onMessage(ctx, message)));
    expect(set).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await onMessage(ctx, message);
    expect(set).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('does not invent a local deadline for a cooldown acquired elsewhere', async () => {
    const { ctx, message, set, upsert } = setup();
    set.mockResolvedValueOnce(null);
    await onMessage(ctx, message);
    await onMessage(ctx, message);
    expect(set).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('honors disabling cooldowns immediately', async () => {
    const { ctx, message, config, set, upsert } = setup();
    await onMessage(ctx, message);
    config.cooldownSec = 0;
    await onMessage(ctx, message);
    expect(set).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
