import type { InteractionContext } from '@bot/core';
import { describe, expect, it, vi } from 'vitest';
import { autorolesCommand } from './commands.js';
import { defaultAutorolesConfig, type AutorolesConfig } from './config.js';

const GUILD = '100000000000000001';
const ROLE = '200000000000000002';

function setup({ editable = true, subcommand = 'add', group = 'join' as string | null } = {}) {
  const update = vi.fn(async () => ({}));
  const replyFn = vi.fn(async () => {});
  const role = { id: ROLE, name: 'Member', managed: false, editable, guild: { id: GUILD } };
  const interaction = {
    guildId: GUILD,
    user: { id: '9' },
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => subcommand,
      getRole: () => role,
    },
    reply: replyFn,
  };
  const ctx = {
    getConfig: async () => defaultAutorolesConfig,
    config: { update },
    t: (key: string) => key,
  } as unknown as InteractionContext<AutorolesConfig>;
  return { interaction, ctx, update, replyFn };
}

describe('/autoroles', () => {
  it('builds a valid Discord command with subcommand groups', () => {
    const json = autorolesCommand.data.toJSON();
    expect(json.name).toBe('autoroles');
    expect(json.options?.map((o) => o.name)).toEqual(['list', 'join', 'persistence', 'panel']);
  });

  it('adds an assignable join role to the config', async () => {
    const { interaction, ctx, update, replyFn } = setup();

    await autorolesCommand.execute(interaction as never, ctx);

    expect(update).toHaveBeenCalledWith(GUILD, 'autoroles', { config: expect.objectContaining({ joinRoles: { humans: [ROLE], bots: [], delaySec: 0 } }) }, '9');
    expect(replyFn).toHaveBeenCalledWith(expect.objectContaining({ content: 'autoroles.reply.joinAdded' }));
  });

  it('refuses roles above the bot', async () => {
    const { interaction, ctx, update, replyFn } = setup({ editable: false });

    await autorolesCommand.execute(interaction as never, ctx);

    expect(update).not.toHaveBeenCalled();
    expect(replyFn).toHaveBeenCalledWith(expect.objectContaining({ content: 'autoroles.reply.higherRole' }));
  });
});
