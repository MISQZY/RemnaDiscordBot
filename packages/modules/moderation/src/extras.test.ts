import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { matchesClear } from './commands.js';
import { defaultModerationConfig, ModerationConfig } from './config.js';
import { LOCK_BITS, lockOverwrite, unlockOverwrite } from './lockdown.js';
import { canPunish, isSpared } from './honeypot.js';
import { nativeCase } from './native.js';

describe('lockdown overwrites', () => {
  it('denies writing and remembers only what it changed', () => {
    const current = { allow: PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles, deny: PermissionFlagsBits.AddReactions };
    const locked = lockOverwrite(current);

    expect(locked.allow).toBe(PermissionFlagsBits.AttachFiles);
    expect(locked.deny & LOCK_BITS).toBe(LOCK_BITS);
    expect(locked.removedAllow).toBe(PermissionFlagsBits.SendMessages);
    // Reactions were denied already: unlocking must keep them denied.
    expect(locked.addedDeny & PermissionFlagsBits.AddReactions).toBe(0n);

    const restored = unlockOverwrite({ allow: locked.allow, deny: locked.deny }, { addedDeny: locked.addedDeny.toString(), removedAllow: locked.removedAllow.toString() });
    expect(restored).toEqual(current);
  });

  it('restores an empty overwrite for a channel that had none', () => {
    const locked = lockOverwrite(null);
    expect(unlockOverwrite({ allow: locked.allow, deny: locked.deny }, { addedDeny: locked.addedDeny.toString(), removedAllow: '0' })).toEqual({ allow: 0n, deny: 0n });
  });

  it('keeps permissions changed during the lockdown', () => {
    const locked = lockOverwrite(null);
    const edited = { allow: locked.allow | PermissionFlagsBits.EmbedLinks, deny: locked.deny };
    expect(unlockOverwrite(edited, { addedDeny: locked.addedDeny.toString(), removedAllow: '0' })).toEqual({ allow: PermissionFlagsBits.EmbedLinks, deny: 0n });
  });
});

describe('nativeCase', () => {
  const now = Date.parse('2026-10-22T10:00:00Z');

  it('maps bans, kicks and timeouts from the audit log', () => {
    expect(nativeCase({ action: AuditLogEvent.MemberBanAdd, changes: [] }, now)).toEqual({ type: 'ban', durationSec: null });
    expect(nativeCase({ action: AuditLogEvent.MemberKick, changes: [] }, now)).toEqual({ type: 'kick', durationSec: null });
    expect(
      nativeCase({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'communication_disabled_until', new: '2026-10-22T11:00:00Z' }] } as never, now),
    ).toEqual({ type: 'mute', durationSec: 3600 });
    expect(nativeCase({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'communication_disabled_until', old: '2026-10-22T11:00:00Z' }] } as never, now)).toEqual({
      type: 'unmute',
      durationSec: null,
    });
  });

  it('ignores other member updates', () => {
    expect(nativeCase({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'nick', new: 'x' }] } as never, now)).toBeNull();
    expect(nativeCase({ action: AuditLogEvent.ChannelCreate, changes: [] }, now)).toBeNull();
  });
});

describe('matchesClear', () => {
  const message = (content: string, { bot = false, files = 0, id = '1' } = {}) => ({ author: { id, bot }, content, attachments: { size: files } });

  it('filters by kind of message, author and text', () => {
    expect(matchesClear(message('hi', { bot: true }), { filter: 'bots' })).toBe(true);
    expect(matchesClear(message('hi'), { filter: 'bots' })).toBe(false);
    expect(matchesClear(message('see https://x.y'), { filter: 'links' })).toBe(true);
    expect(matchesClear(message('join discord.gg/abc'), { filter: 'invites' })).toBe(true);
    expect(matchesClear(message('', { files: 1 }), { filter: 'attachments' })).toBe(true);
    expect(matchesClear(message('Buy NOW'), { contains: 'buy now' })).toBe(true);
    expect(matchesClear(message('hi', { id: '2' }), { userId: '1' })).toBe(false);
  });
});

describe('honeypot', () => {
  const member = (id: string, moderator = false) => ({ id, guild: { ownerId: 'owner' }, permissions: { has: () => moderator } });

  it('spares bots, the owner and moderators', () => {
    expect(isSpared(member('1'), true)).toBe(true);
    expect(isSpared(member('owner'), false)).toBe(true);
    expect(isSpared(member('2', true), false)).toBe(true);
    expect(isSpared(member('3'), false)).toBe(false);
  });

  it('checks the permission the action needs', () => {
    const target = { bannable: false, kickable: true, moderatable: true };
    expect(canPunish(target, 'softban')).toBe(false);
    expect(canPunish(target, 'kick')).toBe(true);
  });
});

describe('ModerationConfig', () => {
  it('reads configs saved before the new fields', () => {
    const { appealUrl, dmNote, trackNativeActions, reportChannelId, reportRoleId, lockdown, honeypot, ...old } = defaultModerationConfig;
    expect(ModerationConfig.parse(old)).toEqual(defaultModerationConfig);
    expect([appealUrl, dmNote, trackNativeActions, reportChannelId, reportRoleId, lockdown, honeypot]).toBeDefined();
  });

  it('accepts only http links for appeals', () => {
    expect(ModerationConfig.safeParse({ ...defaultModerationConfig, appealUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(ModerationConfig.safeParse({ ...defaultModerationConfig, appealUrl: 'https://forms.example/appeal' }).success).toBe(true);
  });
});
