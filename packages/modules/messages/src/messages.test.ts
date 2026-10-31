import type { BotModuleContext } from '@bot/core';
import type { Message } from 'discord.js';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { clearStickyTimers, onMessage } from './bot.js';
import { defaultMessagesConfig, ScheduledInput, type MessagesConfig } from './config.js';
import { nextRun } from './service.js';

describe('nextRun', () => {
  const from = new Date('2026-10-22T10:00:00Z');

  it('repeats after the interval and none for a one-off message', () => {
    expect(nextRun(from, 60, new Date('2026-10-22T10:00:30Z'))).toEqual(new Date('2026-10-22T11:00:00Z'));
    expect(nextRun(from, 0)).toBeNull();
  });

  it('skips the runs missed while the worker was down', () => {
    expect(nextRun(from, 60, new Date('2026-10-22T13:30:00Z'))).toEqual(new Date('2026-10-22T14:00:00Z'));
    expect(nextRun(from, 60, new Date('2026-10-22T13:00:00Z'))).toEqual(new Date('2026-10-22T14:00:00Z'));
  });
});

describe('ScheduledInput', () => {
  it('allows once or repeats from ten minutes', () => {
    const base = { channelId: '100000000000000001', message: { content: 'x' }, nextRunAt: '2026-10-22T10:00:00+03:00', enabled: true };
    expect(ScheduledInput.safeParse({ ...base, intervalMin: 0 }).success).toBe(true);
    expect(ScheduledInput.safeParse({ ...base, intervalMin: 5 }).success).toBe(false);
    expect(ScheduledInput.safeParse({ ...base, intervalMin: 1440 }).success).toBe(true);
  });
});

describe('onMessage', () => {
  beforeEach(() => {
    clearStickyTimers();
  });
  afterEach(() => clearStickyTimers());

  it('ignores messages from the bot itself or outside guilds', async () => {
    const exists = vi.fn();
    const ctx = {
      client: { user: { id: 'bot-1' } },
      redis: { exists },
    } as unknown as BotModuleContext<MessagesConfig>;

    await onMessage(ctx, { inGuild: () => false, author: { id: 'user-1' }, channelId: 'c1' } as unknown as Message);
    await onMessage(ctx, { inGuild: () => true, author: { id: 'bot-1' }, channelId: 'c1' } as unknown as Message);

    expect(exists).not.toHaveBeenCalled();
  });

  it('caches negative sticky lookup across multiple messages', async () => {
    const exists = vi.fn().mockResolvedValue(0);
    const ctx = {
      client: { user: { id: 'bot-1' } },
      redis: { exists },
    } as unknown as BotModuleContext<MessagesConfig>;

    const msg = { inGuild: () => true, author: { id: 'user-1' }, channelId: 'c1', guildId: 'g1' } as unknown as Message;

    await onMessage(ctx, msg);
    await onMessage(ctx, msg);
    await onMessage(ctx, msg);

    expect(exists).toHaveBeenCalledTimes(1);
    expect(exists).toHaveBeenCalledWith('messages:sticky:c1');
  });

  it('sets timer and schedules repost when channel has sticky message', async () => {
    const exists = vi.fn().mockResolvedValue(1);
    const getConfig = vi.fn().mockResolvedValue(defaultMessagesConfig);
    const ctx = {
      client: { user: { id: 'bot-1' } },
      redis: { exists },
      getConfig,
      logger: { warn: vi.fn() },
    } as unknown as BotModuleContext<MessagesConfig>;

    const msg = { inGuild: () => true, author: { id: 'user-1' }, channelId: 'c2', guildId: 'g1' } as unknown as Message;

    await onMessage(ctx, msg);
    expect(getConfig).toHaveBeenCalledWith('g1');
  });
});
