import type { InteractionContext } from '@bot/core';
import { describe, expect, it, vi } from 'vitest';
import { logs } from './commands.js';
import { defaultAuditLogConfig, type AuditLogConfig } from './config.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000002';
const ROLE = '300000000000000003';

function setup({
  sub,
  group = null as string | null,
  category = 'messages',
  canPost = true,
  config = defaultAuditLogConfig,
  role = null as { id: string } | null,
  channel = { id: CHANNEL } as { id: string } | null,
}: {
  sub: string;
  group?: string | null;
  category?: string;
  canPost?: boolean;
  config?: AuditLogConfig;
  role?: { id: string } | null;
  channel?: { id: string } | null;
}) {
  const update = vi.fn(async () => ({}));
  const reply = vi.fn(async () => {});
  const guildChannel = channel && { ...channel, guild: { members: { me: {} } }, permissionsFor: () => ({ has: () => canPost }) };
  const interaction = {
    guildId: GUILD,
    user: { id: '9' },
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
      getString: () => category,
      getChannel: () => guildChannel,
      getRole: () => role,
      getBoolean: () => false,
    },
    reply,
  };
  const ctx = {
    moduleId: 'audit-log',
    getConfig: async () => config,
    config: { update },
    t: (key: string) => key,
  } as unknown as InteractionContext<AuditLogConfig>;
  return { interaction, ctx, update, reply };
}

const saved = (update: ReturnType<typeof vi.fn>) => (update.mock.calls[0] as unknown as [string, string, { config: AuditLogConfig }])[2].config;

describe('/logs', () => {
  it('builds a valid Discord command', () => {
    expect(logs.data.toJSON().options?.map((o) => o.name)).toEqual(['show', 'set', 'disable', 'ignore', 'bots']);
  });

  it('logs a category to a channel the bot can post in', async () => {
    const { interaction, ctx, update } = setup({ sub: 'set' });
    await logs.execute(interaction as never, ctx);
    expect(saved(update).channels.messages).toBe(CHANNEL);
  });

  it('refuses channels the bot cannot post in', async () => {
    const { interaction, ctx, update, reply } = setup({ sub: 'set', canPost: false });
    await logs.execute(interaction as never, ctx);
    expect(update).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'audit-log.settings.noAccess' }));
  });

  it('turns every category off at once', async () => {
    const config = { ...defaultAuditLogConfig, channels: { ...defaultAuditLogConfig.channels, voice: CHANNEL, server: CHANNEL } };
    const { interaction, ctx, update } = setup({ sub: 'disable', category: 'all', config });
    await logs.execute(interaction as never, ctx);
    expect(Object.values(saved(update).channels).every((id) => id === null)).toBe(true);
  });

  it('adds and removes exclusions', async () => {
    const add = setup({ sub: 'add', group: 'ignore', role: { id: ROLE } });
    await logs.execute(add.interaction as never, add.ctx);
    expect(saved(add.update)).toMatchObject({ ignoredChannelIds: [CHANNEL], ignoredRoleIds: [ROLE] });

    const config = { ...defaultAuditLogConfig, ignoredChannelIds: [CHANNEL], ignoredRoleIds: [ROLE] };
    const remove = setup({ sub: 'remove', group: 'ignore', channel: null, role: { id: ROLE }, config });
    await logs.execute(remove.interaction as never, remove.ctx);
    expect(saved(remove.update)).toMatchObject({ ignoredChannelIds: [CHANNEL], ignoredRoleIds: [] });
  });
});
