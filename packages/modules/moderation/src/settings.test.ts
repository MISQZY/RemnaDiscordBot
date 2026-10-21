import { localizeCommand, type InteractionContext } from '@bot/core';
import { I18n } from '@bot/i18n';
import { describe, expect, it, vi } from 'vitest';
import { defaultModerationConfig, type ModerationConfig } from './config.js';
import moderation from './index.js';
import { modsettings, slowmode } from './settings.js';

const GUILD = '100000000000000001';

function setup(options: { sub: string; group?: string | null; strings?: Record<string, string | null>; ints?: Record<string, number> }) {
  const update = vi.fn(async () => ({}));
  const reply = vi.fn(async () => {});
  const interaction = {
    guildId: GUILD,
    user: { id: '9', username: 'mod' },
    options: {
      getSubcommandGroup: () => options.group ?? null,
      getSubcommand: () => options.sub,
      getString: (name: string) => options.strings?.[name] ?? null,
      getInteger: (name: string) => options.ints?.[name] ?? null,
      getBoolean: () => true,
      getChannel: () => null,
    },
    channel: null,
    reply,
  };
  const ctx = {
    moduleId: 'moderation',
    locale: 'en',
    getConfig: async () => defaultModerationConfig,
    config: { update },
    t: (key: string) => key,
  } as unknown as InteractionContext<ModerationConfig>;
  return { interaction, ctx, update, reply };
}

const saved = (update: ReturnType<typeof vi.fn>) => (update.mock.calls[0] as unknown as [string, string, { config: ModerationConfig }])[2].config;

describe('/modsettings', () => {
  it('has localized subcommands', () => {
    const i18n = new I18n('ru');
    i18n.register(moderation.id, moderation.locales!);
    const json = localizeCommand(modsettings.data.toJSON(), i18n, 'moderation') as { options: { name: string; description_localizations?: Record<string, string> }[] };
    expect(json.options.map((o) => o.name)).toEqual(['show', 'log-channel', 'dm', 'require-reason', 'warn-expiry', 'appeal', 'dm-note', 'reports', 'native-cases', 'honeypot', 'escalation']);
    expect(json.options.every((o) => o.description_localizations?.ru)).toBe(true);
  });

  it('replaces the escalation rule for the same warning count', async () => {
    const { interaction, ctx, update } = setup({ sub: 'add', group: 'escalation', ints: { warns: 3 }, strings: { action: 'ban', duration: '7d' } });
    await modsettings.execute(interaction as never, ctx);
    expect(saved(update).escalation).toEqual([
      { warns: 3, action: 'ban', durationSec: 7 * 86_400 },
      { warns: 5, action: 'ban', durationSec: null },
    ]);
  });

  it('requires a duration for mutes', async () => {
    const { interaction, ctx, update, reply } = setup({ sub: 'add', group: 'escalation', ints: { warns: 2 }, strings: { action: 'mute' } });
    await modsettings.execute(interaction as never, ctx);
    expect(update).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'moderation.settings.badRuleDuration' }));
  });

  it('sets the warning lifetime', async () => {
    const { interaction, ctx, update } = setup({ sub: 'warn-expiry', ints: { days: 0 } });
    await modsettings.execute(interaction as never, ctx);
    expect(saved(update).warnExpiryDays).toBe(0);
  });
});

describe('/slowmode', () => {
  it('rejects intervals Discord does not allow', async () => {
    const { interaction, ctx, reply } = setup({ sub: '', strings: { interval: '7h' } });
    await slowmode.execute(interaction as never, ctx);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'moderation.errors.invalidSlowmode' }));
  });
});
