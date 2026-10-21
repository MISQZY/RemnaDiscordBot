import { describe, expect, it, vi } from 'vitest';
import { applyAction, channelName } from './bot.js';
import { TempVoiceConfig } from './config.js';

const channel = (members: string[] = []) => ({
  id: 'c1',
  guild: { roles: { everyone: { id: 'g' } } },
  members: new Map(members.map((id) => [id, { voice: { disconnect: vi.fn(async () => undefined) } }])),
  permissionOverwrites: { edit: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) },
  setUserLimit: vi.fn(async () => undefined),
  setName: vi.fn(async () => undefined),
});
const member = (id: string, manager = false) => ({ id, permissions: { has: () => manager } });
const db = (ownerId = 'owner') => {
  const row = { channelId: 'c1', guildId: 'g', ownerId, creatorId: 'lobby' };
  return { tempVoiceChannel: { findUnique: vi.fn(async () => row), update: vi.fn(async () => row) } };
};

describe('temp voice', () => {
  it('names channels from the template', () => {
    expect(channelName({ nameTemplate: '🔊 {user.displayName} #{count}' }, { displayName: 'Ann', username: 'ann' }, 3)).toBe('🔊 Ann #3');
  });

  it('lets only the owner or a manager change the channel', async () => {
    const c = channel(['owner']);
    expect(await applyAction({ db: db() } as never, member('other') as never, c as never, 'lock')).toEqual({ key: 'notOwner' });
    expect(await applyAction({ db: db() } as never, member('owner') as never, c as never, 'lock')).toEqual({ key: 'locked' });
    expect(c.permissionOverwrites.edit).toHaveBeenCalledWith({ id: 'g' }, { Connect: false });
    expect(await applyAction({ db: db() } as never, member('mod', true) as never, c as never, 'limit', '5')).toEqual({ key: 'limitSet', vars: { limit: 5 } });
    expect(await applyAction({ db: db() } as never, member('owner') as never, c as never, 'limit', '120')).toEqual({ key: 'badLimit' });
  });

  it('gives a channel away only while its owner is gone', async () => {
    expect(await applyAction({ db: db() } as never, member('guest') as never, channel(['owner', 'guest']) as never, 'claim')).toEqual({ key: 'ownerHere' });
    const store = db();
    expect(await applyAction({ db: store } as never, member('guest') as never, channel(['guest']) as never, 'claim')).toEqual({ key: 'claimed' });
    expect(store.tempVoiceChannel.update).toHaveBeenCalledWith({ where: { channelId: 'c1' }, data: { ownerId: 'guest' } });
  });

  it('refuses the same creator channel twice', () => {
    const creator = { channelId: '100000000000000001', categoryId: null, nameTemplate: '{user.displayName}', userLimit: 0 };
    expect(TempVoiceConfig.safeParse({ creators: [creator, creator], controlPanel: true }).success).toBe(false);
  });
});
