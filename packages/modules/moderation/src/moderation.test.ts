import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { hierarchyError, isMemberModerator } from './checks.js';
import { defaultModerationConfig, isActive, ModerationConfig } from './config.js';
import { formatDuration, parseDuration } from './duration.js';
import { escalationAllowed } from './service.js';

describe('parseDuration', () => {
  it('parses English and Russian units', () => {
    expect(parseDuration('10m')).toBe(600);
    expect(parseDuration('1h30m')).toBe(5400);
    expect(parseDuration('2д')).toBe(172_800);
    expect(parseDuration('1ч 15мин')).toBe(4500);
    expect(parseDuration('1w')).toBe(604_800);
  });

  it('rejects garbage and partial matches', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('10x')).toBeNull();
    expect(parseDuration('10m later')).toBeNull();
    expect(parseDuration('0m')).toBeNull();
  });

  it('formats durations per locale', () => {
    expect(formatDuration(93_784, 'ru')).toBe('1д 2ч 3мин 4с');
    expect(formatDuration(3600, 'en')).toBe('1h');
  });
});

describe('hierarchyError', () => {
  const role = (position: number) => ({ comparePositionTo: (other: { position: number }) => position - other.position, position });
  const guild = { ownerId: 'owner', client: { user: { id: 'bot' } } };
  const member = (id: string, position: number, abilities = { bannable: true, kickable: true, moderatable: true }) =>
    ({ id, guild, roles: { highest: role(position) }, ...abilities }) as unknown as GuildMember;

  it('allows punishing lower members', () => {
    expect(hierarchyError(member('mod', 5), member('user', 1), 'ban')).toBeNull();
  });

  it('blocks self, owner, bot and equal or higher roles', () => {
    expect(hierarchyError(member('mod', 5), member('mod', 5), 'warn')).toBe('moderation.errors.self');
    expect(hierarchyError(member('mod', 5), member('owner', 1), 'kick')).toBe('moderation.errors.owner');
    expect(hierarchyError(member('mod', 5), member('bot', 1), 'mute')).toBe('moderation.errors.bot');
    expect(hierarchyError(member('mod', 5), member('user', 5), 'ban')).toBe('moderation.errors.hierarchy');
  });

  it('lets the owner punish anyone the bot can', () => {
    expect(hierarchyError(member('owner', 1), member('user', 9), 'kick')).toBeNull();
  });

  it('reports when the bot itself cannot act', () => {
    expect(hierarchyError(member('mod', 5), member('user', 1, { bannable: false, kickable: true, moderatable: true }), 'ban')).toBe(
      'moderation.errors.botHierarchy',
    );
  });
});

describe('ModerationConfig', () => {
  it('accepts the defaults', () => {
    expect(ModerationConfig.safeParse(defaultModerationConfig).success).toBe(true);
  });

  it('requires mute rules to have a duration up to 28 days and unique thresholds', () => {
    const rule = { warns: 2, action: 'mute' as const, durationSec: null };
    expect(ModerationConfig.safeParse({ ...defaultModerationConfig, escalation: [rule] }).success).toBe(false);
    const dup = { warns: 3, action: 'kick' as const, durationSec: null };
    expect(ModerationConfig.safeParse({ ...defaultModerationConfig, escalation: [dup, dup] }).success).toBe(false);
  });
});

describe('isActive', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  it('treats revoked, expired and instant cases as inactive', () => {
    expect(isActive({ type: 'ban', revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(isActive({ type: 'mute', revokedAt: null, expiresAt: new Date('2026-10-19T11:00:00Z') }, now)).toBe(false);
    expect(isActive({ type: 'warn', revokedAt: now, expiresAt: null }, now)).toBe(false);
    expect(isActive({ type: 'kick', revokedAt: null, expiresAt: null }, now)).toBe(false);
  });
});

describe('isMemberModerator', () => {
  const guild = { ownerId: '10' };
  const createMember = ({
    id = '20',
    roles = [] as string[],
    perms = [] as bigint[],
  } = {}) =>
    ({
      id,
      guild,
      roles: { cache: new Map(roles.map((r) => [r, { id: r }])) },
      permissions: {
        has: (p: bigint) => perms.includes(p) || perms.includes(PermissionFlagsBits.Administrator),
      },
    }) as unknown as GuildMember;

  it('allows guild owner without roles or permissions', () => {
    const owner = createMember({ id: '10' });
    expect(isMemberModerator(owner, [])).toBe(true);
  });

  it('allows administrator or manage guild', () => {
    const admin = createMember({ perms: [PermissionFlagsBits.Administrator] });
    expect(isMemberModerator(admin, [])).toBe(true);

    const manager = createMember({ perms: [PermissionFlagsBits.ManageGuild] });
    expect(isMemberModerator(manager, [])).toBe(true);
  });

  it('allows discordPermission when member has it', () => {
    const mod = createMember({ perms: [PermissionFlagsBits.ModerateMembers] });
    expect(isMemberModerator(mod, [], PermissionFlagsBits.ModerateMembers)).toBe(true);
    expect(isMemberModerator(mod, [], PermissionFlagsBits.BanMembers)).toBe(false);
  });

  it('allows member having one of modRoleIds even without discord permissions', () => {
    const roleUser = createMember({ roles: ['role-mod-1'] });
    expect(isMemberModerator(roleUser, ['role-mod-1', 'role-mod-2'], PermissionFlagsBits.BanMembers)).toBe(true);
  });

  it('denies user without permissions or mod roles', () => {
    const regular = createMember({ roles: ['role-regular'] });
    expect(isMemberModerator(regular, ['role-mod-1'], PermissionFlagsBits.ModerateMembers)).toBe(false);
    expect(isMemberModerator(null, ['role-mod-1'])).toBe(false);
  });

  it('escalationAllowed supports GuildMember with modRoleIds', () => {
    const roleUser = createMember({ roles: ['role-mod-1'] });
    const canEscalate = escalationAllowed(roleUser, ['role-mod-1']);
    expect(canEscalate('ban')).toBe(true);
    expect(canEscalate('kick')).toBe(true);
    expect(canEscalate('mute')).toBe(true);

    const regular = createMember();
    const cannotEscalate = escalationAllowed(regular, ['role-mod-1']);
    expect(cannotEscalate('ban')).toBe(false);
  });
});
