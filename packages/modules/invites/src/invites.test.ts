import { createTestRedis } from '@bot/testing';
import { describe, expect, it } from 'vitest';
import { earnedRoles, readUses, saveUses, usedInvite } from './service.js';

describe('invites', () => {
  it('finds the invite whose uses grew, and gives up when several did', () => {
    const before = { a: 3, b: 1 };
    expect(usedInvite(before, [{ code: 'a', uses: 3, inviterId: '1' }, { code: 'b', uses: 2, inviterId: '2' }])).toEqual({ code: 'b', inviterId: '2' });
    expect(usedInvite(before, [{ code: 'new', uses: 1, inviterId: '3' }])).toEqual({ code: 'new', inviterId: '3' });
    expect(usedInvite(before, [{ code: 'a', uses: 4, inviterId: '1' }, { code: 'b', uses: 2, inviterId: '2' }])).toBeNull();
    expect(usedInvite(before, [{ code: 'a', uses: 3, inviterId: '1' }])).toBeNull();
  });

  it('keeps a snapshot of invite uses in Redis', async () => {
    const redis = createTestRedis();
    await saveUses({ redis }, 'g', [{ code: 'a', uses: 2 }]);
    await saveUses({ redis }, 'g', [{ code: 'b', uses: 5 }]);
    expect(await readUses({ redis }, 'g')).toEqual({ b: 5 });
  });

  it('gives every reward up to the count', () => {
    const rewards = [{ invites: 5, roleId: 'five' }, { invites: 1, roleId: 'one' }, { invites: 10, roleId: 'ten' }];
    expect(earnedRoles(rewards, 6)).toEqual(['five', 'one']);
  });
});
