import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { hierarchyError } from './checks.js';
import { defaultModerationConfig, isActive, ModerationConfig } from './config.js';
import { formatDuration, parseDuration } from './duration.js';

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
