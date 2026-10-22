import { describe, expect, it } from 'vitest';
import { EntityChecker } from './validation.js';

const guild = {
  channels: [
    { id: '1', name: 'general', type: 0, parentId: null, position: 0 },
    { id: '2', name: 'Voice', type: 2, parentId: null, position: 1 },
  ],
  roles: [
    { id: '10', name: 'Member', color: 0, position: 1, managed: false, manageable: true },
    { id: '11', name: 'Admin', color: 0, position: 9, managed: false, manageable: false },
    { id: '12', name: 'Mod', color: 0, position: 2, managed: false, manageable: false, elevated: true },
  ],
};

describe('EntityChecker', () => {
  it('accepts existing text channels and assignable roles, skips empty values', () => {
    const { issues } = new EntityChecker(guild).textChannel('1', ['channelId']).assignableRole('10', ['roleId']).textChannel(null, ['x']);
    expect(issues).toEqual([]);
  });

  it('reports missing and unsuitable entities with paths', () => {
    const { issues } = new EntityChecker(guild)
      .textChannel('2', ['join', 'channelId'])
      .textChannel('99', ['leave', 'channelId'])
      .roles(['10', '11', '98', '12'], ['joinRoles'], { assignable: true });

    expect(issues).toEqual([
      { path: ['join', 'channelId'], message: 'Channel 2 is not a text channel' },
      { path: ['leave', 'channelId'], message: 'Channel 99 not found' },
      { path: ['joinRoles', 1], message: 'The bot cannot assign role Admin' },
      { path: ['joinRoles', 2], message: 'Role 98 not found' },
      { path: ['joinRoles', 3], message: 'Role Mod has moderator permissions — the bot does not hand it out' },
    ]);
  });
});
