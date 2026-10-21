import { createTestRedis } from '@bot/testing';
import { describe, expect, it, vi } from 'vitest';
import { counterName, updateCounters } from './service.js';

const stats = { members: 120, online: 30, boosts: 4, boostTier: 1, channels: 12, roles: 8 };

describe('server stats', () => {
  it('puts the numbers into the template', () => {
    expect(counterName('👥 {members} · 🟢 {online}', stats)).toBe('👥 120 · 🟢 30');
  });

  it('renames only the counters whose names changed', async () => {
    const patch = vi.fn(async () => ({}));
    const rest = {
      get: vi.fn(async (route: string) =>
        route.endsWith('/channels')
          ? [
              { id: 'a', type: 2, name: 'Members: 120' },
              { id: 'b', type: 2, name: 'Old' },
            ]
          : { approximate_member_count: 120, approximate_presence_count: 30, premium_subscription_count: 4, premium_tier: 1, roles: [{}, {}] },
      ),
      patch,
    };
    const config = { counters: [{ channelId: 'a', template: 'Members: {members}' }, { channelId: 'b', template: 'Boosts: {boosts}' }, { channelId: 'gone', template: 'x' }] };
    const services = { rest, logger: { warn: vi.fn() }, redis: createTestRedis() } as never;
    expect(await updateCounters(services, 'g', config)).toBe(1);
    expect(patch).toHaveBeenCalledWith('/channels/b', { body: { name: 'Boosts: 4' }, reason: 'Server stats' });

    // Renamed just now: the next change of this channel waits out Discord's limit.
    expect(await updateCounters(services, 'g', { counters: [{ channelId: 'b', template: 'Boosts now: {boosts}' }] })).toBe(0);
  });
});
