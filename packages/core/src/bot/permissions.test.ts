import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { canManageGuild, requireManageGuild } from './permissions.js';

describe('runtime guild permissions', () => {
  const interaction = (permissions: bigint, guildId: string | null = 'guild') => ({
    guildId, memberPermissions: new PermissionsBitField(permissions), reply: vi.fn().mockResolvedValue(undefined),
  });

  it('requires ManageGuild or Administrator in a guild', () => {
    expect(canManageGuild(interaction(PermissionFlagsBits.ManageGuild))).toBe(true);
    expect(canManageGuild(interaction(PermissionFlagsBits.Administrator))).toBe(true);
    expect(canManageGuild(interaction(PermissionFlagsBits.ModerateMembers))).toBe(false);
    expect(canManageGuild(interaction(PermissionFlagsBits.ManageGuild, null))).toBe(false);
    expect(canManageGuild({ guildId: 'guild', memberPermissions: null })).toBe(false);
  });

  it('refuses integration overrides before a mutation can run', async () => {
    const denied = interaction(0n);
    expect(await requireManageGuild(denied, { t: (key) => key })).toBe(false);
    expect(denied.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'core.manageGuildRequired' }));
    const allowed = interaction(PermissionFlagsBits.ManageGuild);
    expect(await requireManageGuild(allowed, { t: (key) => key })).toBe(true);
    expect(allowed.reply).not.toHaveBeenCalled();
  });
});
