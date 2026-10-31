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
      {
        path: ['join', 'channelId'],
        message: 'Channel 2 is not a text channel',
        action: 'Choose a text channel instead of a voice or category channel',
        severity: 'error',
      },
      {
        path: ['leave', 'channelId'],
        message: 'Channel 99 not found',
        action: 'Select an existing channel in server settings',
        severity: 'error',
      },
      {
        path: ['joinRoles', 1],
        message: 'The bot cannot assign role Admin',
        action: "In Discord Server Settings → Roles, drag the bot's role above @Admin",
        severity: 'error',
      },
      {
        path: ['joinRoles', 2],
        message: 'Role 98 not found',
        action: 'Select an existing role in server settings',
        severity: 'error',
      },
      {
        path: ['joinRoles', 3],
        message: 'Role Mod has moderator permissions — the bot does not hand it out',
        action: 'Use a dedicated member role without administrator or moderation permissions',
        severity: 'error',
      },
    ]);
  });

  it('detects when the bot lacks send permissions in a channel', () => {
    const guildWithPerms = {
      channels: [{ id: '1', name: 'logs', type: 0, parentId: null, position: 0, canSend: false }],
      roles: [],
    };
    const { issues } = new EntityChecker(guildWithPerms).textChannel('1', ['logChannelId']);
    expect(issues).toEqual([
      {
        path: ['logChannelId'],
        message: 'Bot lacks permission to send messages in #logs',
        action: 'Grant the bot Send Messages and View Channel permissions in #logs',
        severity: 'error',
      },
    ]);
  });
});
