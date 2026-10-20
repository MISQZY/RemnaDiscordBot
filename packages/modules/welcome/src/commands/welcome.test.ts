import type { InteractionContext } from '@bot/core';
import { I18n } from '@bot/i18n';
import { describe, expect, it, vi } from 'vitest';
import { defaultWelcomeConfig, type WelcomeConfig } from '../config.js';
import { locales } from '../locales.js';
import { messageModalHandler, welcomeCommand } from './welcome.js';

const GUILD = '100000000000000001';
const CHANNEL = '500000000000000005';

function setup({ subcommand = 'show', kind = 'join', config = defaultWelcomeConfig, canSend = true } = {}) {
  const i18n = new I18n();
  i18n.register('welcome', locales);
  let stored: WelcomeConfig = structuredClone(config);
  const update = vi.fn(async (_guildId: string, _moduleId: string, { config: next }: { config: WelcomeConfig }) => {
    stored = next;
  });
  const replies: unknown[] = [];
  const interaction = {
    guildId: GUILD,
    user: { id: '9' },
    guild: { members: { me: {} } },
    options: {
      getSubcommand: () => subcommand,
      getString: () => kind,
      getChannel: () => ({ id: CHANNEL, permissionsFor: () => ({ has: () => canSend }) }),
    },
    reply: vi.fn(async (payload: unknown) => void replies.push(payload)),
    showModal: vi.fn(async () => {}),
  };
  const ctx = {
    getConfig: async () => stored,
    config: { update },
    i18n,
    guildLocale: 'en',
    t: (key: string, vars?: Record<string, string | number>) => i18n.t('ru', key, vars),
  } as unknown as InteractionContext<WelcomeConfig>;
  return { interaction, ctx, update, replies, stored: () => stored };
}

function modalSubmit(content: string, { kind = 'join', manageGuild = true } = {}) {
  return {
    guildId: GUILD,
    customId: `welcome:message:${kind}`,
    user: { id: '9' },
    member: {
      id: '9',
      nickname: null,
      user: { id: '9', username: 'neo', globalName: 'Neo', bot: false, displayAvatarURL: () => '' },
      guild: {
        id: GUILD,
        name: 'Zion',
        memberCount: 42,
        iconURL: () => null,
        members: { me: null },
        client: { user: { id: '3', displayName: 'Bot', displayAvatarURL: () => '' } },
      },
    },
    memberPermissions: { has: () => manageGuild },
    isModalSubmit: () => true,
    fields: { getTextInputValue: () => content },
    reply: vi.fn(async () => {}),
  };
}

describe('/welcome', () => {
  it('builds a valid Discord command', () => {
    expect(welcomeCommand.data.toJSON().options?.map((o) => o.name)).toEqual(['show', 'channel', 'message', 'enable', 'disable', 'reset', 'test']);
  });

  it('shows settings and warns about a missing channel', async () => {
    const { interaction, ctx, replies } = setup();
    await welcomeCommand.execute(interaction as never, ctx);

    const embed = (replies[0] as { embeds: { data: { fields: { name: string; value: string }[] } }[] }).embeds[0]!.data;
    expect(embed.fields[0]!.name).toBe('⚠️ Приветствие');
    expect(embed.fields[0]!.value).toContain('/welcome channel');
  });

  it('sets the channel and turns the message on', async () => {
    const { interaction, ctx, stored } = setup({ subcommand: 'channel', kind: 'leave' });
    await welcomeCommand.execute(interaction as never, ctx);

    expect(stored().leave).toMatchObject({ channelId: CHANNEL, enabled: true });
  });

  it('refuses a channel the bot cannot post in', async () => {
    const { interaction, ctx, update } = setup({ subcommand: 'channel', canSend: false });
    await welcomeCommand.execute(interaction as never, ctx);

    expect(update).not.toHaveBeenCalled();
  });

  it('does not enable a channel message without a channel', async () => {
    const { interaction, ctx, update, replies } = setup({ subcommand: 'enable', kind: 'leave' });
    await welcomeCommand.execute(interaction as never, ctx);

    expect(update).not.toHaveBeenCalled();
    expect(replies[0]).toMatchObject({ content: expect.stringContaining('/welcome channel') });
  });

  it('opens the editor with the current text', async () => {
    const { interaction, ctx } = setup({ subcommand: 'message', kind: 'dm' });
    await welcomeCommand.execute(interaction as never, ctx);

    const modal = (interaction.showModal.mock.calls[0] as unknown[])[0] as { toJSON(): { custom_id: string; components: unknown[] } };
    expect(modal.toJSON().custom_id).toBe('welcome:message:dm');
    expect(JSON.stringify(modal.toJSON().components)).toContain(defaultWelcomeConfig.joinDm.message.content!);
  });

  it('restores the default text in the server language', async () => {
    const custom = { ...defaultWelcomeConfig, join: { ...defaultWelcomeConfig.join, message: { content: 'Custom' } } };
    const { interaction, ctx, stored } = setup({ subcommand: 'reset', config: custom });
    await welcomeCommand.execute(interaction as never, ctx);

    expect(stored().join.message.content).toBe(locales.en.defaults!['join' as never]);
  });
});

describe('message editor modal', () => {
  it('saves the text and keeps embeds', async () => {
    const withEmbed = { ...defaultWelcomeConfig, join: { ...defaultWelcomeConfig.join, message: { content: 'Old', embeds: [{ title: 'Hi' }] } } };
    const { ctx, stored } = setup({ config: withEmbed });
    const interaction = modalSubmit('Hello {user.mention}!');

    await messageModalHandler.handle(interaction as never, ctx);

    expect(stored().join.message).toEqual({ content: 'Hello {user.mention}!', embeds: [{ title: 'Hi' }] });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Hello <@9>!') }));
  });

  it('requires Manage Server', async () => {
    const { ctx, update } = setup();
    await messageModalHandler.handle(modalSubmit('Hi', { manageGuild: false }) as never, ctx);

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an empty text', async () => {
    const { ctx, update } = setup();
    await messageModalHandler.handle(modalSubmit('   ') as never, ctx);

    expect(update).not.toHaveBeenCalled();
  });
});
