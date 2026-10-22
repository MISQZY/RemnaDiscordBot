import type { BotModuleContext, JobContext } from '@bot/core';
import { createLogger } from '@bot/logger';
import { ButtonStyle, ComponentType, DiscordAPIError, RESTJSONErrorCodes, type GuildMember, type REST } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { onMemberJoin } from './bot.js';
import { defaultAutorolesConfig, type AutorolesConfig, type Panel } from './config.js';
import { assignJoinRoles } from './jobs.js';
import { buildComponents, computeRoleChanges, parseEmoji } from './panel.js';
import { persistedRoles } from './persistence.js';

const logger = createLogger({ service: 'test', level: 'silent', pretty: false });
const items = ['r1', 'r2', 'r3'].map((roleId) => ({ roleId, label: roleId, style: 'secondary' as const }));
const panel = (mode: Panel['mode'], maxRoles: number | null = null) => ({ mode, maxRoles, items });

describe('computeRoleChanges', () => {
  it('toggles a role with a button and respects maxRoles', () => {
    expect(computeRoleChanges(panel('toggle'), new Set(), ['r1'], 'button')).toEqual({ add: ['r1'], remove: [], limited: false });
    expect(computeRoleChanges(panel('toggle'), new Set(['r1']), ['r1'], 'button')).toEqual({ add: [], remove: ['r1'], limited: false });
    expect(computeRoleChanges(panel('toggle', 1), new Set(['r1']), ['r2'], 'button').limited).toBe(true);
  });

  it('keeps only one panel role in unique mode', () => {
    expect(computeRoleChanges(panel('unique'), new Set(['r1', 'other']), ['r2'], 'button')).toEqual({ add: ['r2'], remove: ['r1'], limited: false });
  });

  it('only adds or only removes in add/remove modes', () => {
    expect(computeRoleChanges(panel('add'), new Set(['r1']), ['r1'], 'button')).toEqual({ add: [], remove: [], limited: false });
    expect(computeRoleChanges(panel('remove'), new Set(), ['r1'], 'button')).toEqual({ add: [], remove: [], limited: false });
  });

  it('sets panel roles to the select choice', () => {
    expect(computeRoleChanges(panel('toggle'), new Set(['r1', 'r2', 'other']), ['r2', 'r3'], 'select')).toEqual({
      add: ['r3'],
      remove: ['r1'],
      limited: false,
    });
    expect(computeRoleChanges(panel('toggle', 1), new Set(), ['r1', 'r2'], 'select').limited).toBe(true);
  });

  it('ignores roles that are not in the panel', () => {
    expect(computeRoleChanges(panel('toggle'), new Set(), ['admin'], 'button')).toEqual({ add: [], remove: [], limited: false });
  });
});

describe('buildComponents', () => {
  it('splits buttons into rows of five with role custom ids', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ roleId: `${i}`, label: `R${i}`, style: 'primary' as const, emoji: '🎮' }));
    const rows = buildComponents({ id: 'p1', kind: 'buttons', mode: 'toggle', maxRoles: null, items: many });

    expect(rows.map((row) => row.components.length)).toEqual([5, 2]);
    expect(rows[0]!.components[0]).toEqual({
      type: ComponentType.Button,
      style: ButtonStyle.Primary,
      label: 'R0',
      emoji: { name: '🎮' },
      custom_id: 'ar:p1:0',
    });
  });

  it('builds a single-choice select for unique panels', () => {
    const [row] = buildComponents({ id: 'p1', kind: 'select', mode: 'unique', maxRoles: null, items });
    expect(row!.components[0]).toMatchObject({ type: ComponentType.StringSelect, custom_id: 'ar:p1', min_values: 0, max_values: 1 });
  });

  it('parses custom emojis', () => {
    expect(parseEmoji('<a:party:123>')).toEqual({ id: '123', name: 'party', animated: true });
  });
});

describe('persistedRoles', () => {
  it('filters by mode', () => {
    const roles = ['a', 'b', 'c'];
    expect(persistedRoles(roles, { enabled: true, mode: 'all', roleIds: ['a'] })).toEqual(roles);
    expect(persistedRoles(roles, { enabled: true, mode: 'whitelist', roleIds: ['a'] })).toEqual(['a']);
    expect(persistedRoles(roles, { enabled: true, mode: 'blacklist', roleIds: ['a'] })).toEqual(['b', 'c']);
  });
});

describe('join roles', () => {
  function member(bot = false) {
    const guild = { id: '1' } as { id: string; roles?: unknown };
    const roles = new Map(['10', '11'].map((id) => [id, { id, editable: id === '10', managed: false, permissions: { bitfield: 0n }, guild }]));
    guild.roles = { cache: roles };
    return {
      id: '5',
      user: { bot },
      guild,
      roles: { add: vi.fn(async () => {}) },
    } as unknown as GuildMember & { roles: { add: ReturnType<typeof vi.fn> } };
  }
  const ctx = (config: AutorolesConfig) => {
    const schedule = vi.fn(async () => ({}));
    return {
      ctx: { logger, getConfig: async () => config, scheduler: { schedule } } as unknown as BotModuleContext<AutorolesConfig>,
      schedule,
    };
  };

  it('adds assignable join roles immediately', async () => {
    const m = member();
    const { ctx: context } = ctx({ ...defaultAutorolesConfig, joinRoles: { humans: ['10', '11'], bots: [], delaySec: 0, waitForScreening: false } });

    await onMemberJoin(context, m);

    expect(m.roles.add).toHaveBeenCalledWith('10', 'Autoroles: join roles');
  });

  it('schedules delayed join roles', async () => {
    const m = member();
    const { ctx: context, schedule } = ctx({ ...defaultAutorolesConfig, joinRoles: { humans: ['10'], bots: [], delaySec: 60, waitForScreening: false } });

    await onMemberJoin(context, m);

    expect(m.roles.add).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: 'autoroles', job: 'assignJoinRoles', payload: { userId: '5', roleIds: ['10'] }, key: 'autoroles:join:1:5' }),
    );
  });

  it('assigns roles via REST and skips members who left', async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new DiscordAPIError({ code: RESTJSONErrorCodes.UnknownMember, message: 'Unknown Member' }, RESTJSONErrorCodes.UnknownMember, 404, 'PUT', '/x', {}))
      .mockResolvedValue(undefined);
    const jobCtx = { guildId: '1', logger, rest: { put } as unknown as REST } as unknown as JobContext<AutorolesConfig>;

    await assignJoinRoles({ userId: '500000000000000005', roleIds: ['100000000000000010', '100000000000000011'] }, jobCtx);

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith('/guilds/1/members/500000000000000005/roles/100000000000000011', { reason: 'Autoroles: join roles' });
  });
});
