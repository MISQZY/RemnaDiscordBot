import { describe, expect, it } from 'vitest';
import { defaultWelcomeConfig } from './config.js';
import { inviterVars, onInviteJoined, usesInviter } from './inviter.js';

const config = { ...defaultWelcomeConfig, join: { ...defaultWelcomeConfig.join, message: { content: 'Hi {user}, invited by {inviter}' } } };
const ctx = (enabled: boolean) => ({ config: { isEnabled: async () => enabled } }) as never;

describe('inviter placeholders', () => {
  it('waits only for greetings that mention the inviter', () => {
    expect(usesInviter(defaultWelcomeConfig)).toBe(false);
    expect(usesInviter(config)).toBe(true);
  });

  it('takes the inviter whether it came before or after the greeting', async () => {
    onInviteJoined({ guildId: 'g', userId: 'early', inviterId: '1', code: 'abc', invites: 3 });
    expect(await inviterVars(ctx(true), 'g', 'early', config)).toEqual({ inviter: '<@1>', 'inviter.id': '1', 'inviter.invites': 3, 'invite.code': 'abc' });

    const waiting = inviterVars(ctx(true), 'g', 'late', config);
    onInviteJoined({ guildId: 'g', userId: 'late', inviterId: null, code: 'vanity', invites: 0 });
    expect(await waiting).toMatchObject({ inviter: '—', 'invite.code': 'vanity' });
  });

  it('does not wait when the invites module is off', async () => {
    expect(await inviterVars(ctx(false), 'g', 'x', config)).toEqual({});
  });
});
