import { describe, expect, it, vi } from 'vitest';
import type { LeaderboardEntry } from './config.js';
import { withNames } from './names.js';

const entry = (userId: string, username: string | null): LeaderboardEntry => ({
  rank: 1,
  userId,
  username,
  avatar: null,
  xp: 10,
  level: 1,
  progress: { current: 10, needed: 100 },
  messages: 1,
});

describe('withNames', () => {
  it('names only the entries the bot has no name of', async () => {
    const resolve = vi.fn(async () => ({ '200000000000000002': { username: 'trinity', globalName: 'Trinity', avatar: 'abc' } }));
    const items = await withNames([entry('100000000000000001', 'neo'), entry('200000000000000002', null), entry('300000000000000003', null)], { resolve });

    expect(resolve).toHaveBeenCalledWith(['200000000000000002', '300000000000000003']);
    expect(items.map((e) => [e.username, e.avatar])).toEqual([
      ['neo', null],
      ['trinity', 'abc'],
      [null, null],
    ]);
  });
});
