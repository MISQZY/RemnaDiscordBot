import { describe, expect, it } from 'vitest';
import { entryProblem } from './bot.js';
import { draw } from './service.js';

describe('giveaways', () => {
  it('draws distinct winners, leaving out earlier ones', () => {
    const first = (max: number) => max - 1;
    expect(draw(['a', 'b', 'c'], 2, new Set(), first)).toEqual(['c', 'b']);
    expect(draw(['a', 'b', 'c'], 5, new Set(['b']), first)).toEqual(['c', 'a']);
    expect(draw([], 1)).toEqual([]);
  });

  it('checks the required roles and time on the server', () => {
    const now = Date.parse('2026-10-22T00:00:00Z');
    const member = (roles: string[], joinedDaysAgo: number) => ({ roles: { cache: new Set(roles) }, joinedTimestamp: now - joinedDaysAgo * 86_400_000 });
    expect(entryProblem(member(['vip'], 10), { requiredRoleIds: ['vip'], minMemberDays: 7 }, now)).toBeNull();
    expect(entryProblem(member([], 10), { requiredRoleIds: ['vip'], minMemberDays: 0 }, now)).toMatchObject({ key: 'giveaways.needRoles' });
    expect(entryProblem(member(['vip'], 3), { requiredRoleIds: [], minMemberDays: 7 }, now)).toMatchObject({ key: 'giveaways.tooNew', vars: { days: 7 } });
  });
});
