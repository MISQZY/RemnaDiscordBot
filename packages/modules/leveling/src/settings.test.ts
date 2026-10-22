import { localizeCommand, type InteractionContext } from '@bot/core';
import { I18n } from '@bot/i18n';
import { describe, expect, it, vi } from 'vitest';
import { defaultLevelingConfig, type LevelingConfig } from './config.js';
import leveling from './index.js';
import { levels } from './settings.js';

const GUILD = '100000000000000001';
const ROLE = '200000000000000002';
const CHANNEL = '300000000000000003';

interface Options {
  sub: string;
  group?: string | null;
  ints?: Record<string, number>;
  numbers?: Record<string, number>;
  strings?: Record<string, string>;
  role?: object | null;
  channel?: object | null;
  config?: LevelingConfig;
  /** The server owner's id; the invoker is `9`. */
  owner?: string;
  /** What the invoker's top role compared to the picked one gives: above it when positive. */
  topRoleRank?: number;
}

function setup({ sub, group = null, ints = {}, numbers = {}, strings = {}, role = null, channel = null, config = defaultLevelingConfig, owner = '9', topRoleRank = 1 }: Options) {
  const update = vi.fn(async () => ({}));
  const reply = vi.fn(async () => {});
  const interaction = {
    guildId: GUILD,
    user: { id: '9' },
    inCachedGuild: () => true,
    member: { id: '9', guild: { ownerId: owner }, roles: { highest: { comparePositionTo: () => topRoleRank } } },
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
      getInteger: (name: string) => ints[name] ?? null,
      getNumber: (name: string) => numbers[name] ?? null,
      getString: (name: string) => strings[name] ?? null,
      getBoolean: () => true,
      getRole: () => role,
      getChannel: () => channel,
    },
    reply,
  };
  const ctx = {
    moduleId: 'leveling',
    getConfig: async () => config,
    config: { update },
    t: (key: string) => key,
  } as unknown as InteractionContext<LevelingConfig>;
  return { interaction, ctx, update, reply };
}

const saved = (update: ReturnType<typeof vi.fn>) => (update.mock.calls[0] as unknown as [string, string, { config: LevelingConfig }])[2].config;
const role = (patch: object = {}) => ({ id: ROLE, name: 'Regular', managed: false, editable: true, permissions: { bitfield: 0n }, guild: { id: GUILD }, ...patch });

describe('/levels', () => {
  it('has localized subcommands', () => {
    const i18n = new I18n('ru');
    i18n.register(leveling.id, leveling.locales!);
    const json = localizeCommand(levels.data.toJSON(), i18n, 'leveling') as { options: { name: string; description_localizations?: Record<string, string> }[] };
    expect(json.options.every((o) => o.description_localizations?.ru)).toBe(true);
  });

  it('replaces the reward of a level and keeps one level per role', async () => {
    const config = { ...defaultLevelingConfig, rewards: [{ level: 5, roleId: ROLE }, { level: 10, roleId: '400000000000000004' }] };
    const { interaction, ctx, update } = setup({ sub: 'add', group: 'rewards', ints: { level: 10 }, role: role(), config });
    await levels.execute(interaction as never, ctx);
    expect(saved(update).rewards).toEqual([{ level: 10, roleId: ROLE }]);
  });

  it('refuses roles above the bot', async () => {
    const { interaction, ctx, update, reply } = setup({ sub: 'add', group: 'rewards', ints: { level: 3 }, role: role({ editable: false }) });
    await levels.execute(interaction as never, ctx);
    expect(update).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'leveling.settings.roleTooHigh' }));
  });

  it('refuses roles with moderator permissions, even from the owner', async () => {
    const { interaction, ctx, update, reply } = setup({ sub: 'add', group: 'rewards', ints: { level: 3 }, role: role({ permissions: { bitfield: 1n << 3n } }) });
    await levels.execute(interaction as never, ctx);
    expect(update).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'core.roleElevated' }));
  });

  it('refuses roles not below the invoker unless they own the server', async () => {
    const above = setup({ sub: 'add', group: 'rewards', ints: { level: 3 }, role: role(), owner: '1', topRoleRank: 0 });
    await levels.execute(above.interaction as never, above.ctx);
    expect(above.update).not.toHaveBeenCalled();
    expect(above.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'core.roleAboveYou' }));

    const owner = setup({ sub: 'add', group: 'rewards', ints: { level: 3 }, role: role(), topRoleRank: 0 });
    await levels.execute(owner.interaction as never, owner.ctx);
    expect(owner.update).toHaveBeenCalled();
  });

  it('sets a channel multiplier, replacing the previous one', async () => {
    const config = { ...defaultLevelingConfig, multipliers: [{ type: 'channel' as const, id: CHANNEL, value: 2 }] };
    const { interaction, ctx, update } = setup({ sub: 'set', group: 'multiplier', numbers: { value: 0.5 }, channel: { id: CHANNEL }, config });
    await levels.execute(interaction as never, ctx);
    expect(saved(update).multipliers).toEqual([{ type: 'channel', id: CHANNEL, value: 0.5 }]);
  });

  it('checks the XP range', async () => {
    const { interaction, ctx, update, reply } = setup({ sub: 'xp', ints: { min: 30, max: 10 } });
    await levels.execute(interaction as never, ctx);
    expect(update).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'leveling.settings.minAboveMax' }));
  });

  it('needs a channel for channel announcements', async () => {
    const { interaction, ctx, reply } = setup({ sub: 'announce', strings: { mode: 'channel' } });
    await levels.execute(interaction as never, ctx);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'leveling.settings.pickChannel' }));
  });
});
