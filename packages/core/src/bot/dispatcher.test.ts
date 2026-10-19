import { I18n } from '@bot/i18n';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../bus.js';
import type { BotServices } from '../context.js';
import { registerCoreLocales } from '../locales.js';
import { defineCommand } from '../module.js';
import { ModuleRegistry } from '../registry.js';
import { createTestModule, testLogger } from '../testing/fixtures.js';
import { Dispatcher } from './dispatcher.js';

const GUILD = '111111111111111111';

function setup({ enabled = true, cooldownFree = true } = {}) {
  const execute = vi.fn(async () => {});
  const onMessage = vi.fn();
  const failing = vi.fn(() => {
    throw new Error('boom');
  });

  const leveling = createTestModule('leveling');
  leveling.bot!.commands = [
    defineCommand({
      data: { name: 'rank', toJSON: () => ({ name: 'rank', description: 'rank' }) },
      cooldownMs: 5000,
      execute,
    }),
  ];
  leveling.bot!.events = { messageCreate: onMessage };
  const broken = createTestModule('broken');
  broken.bot!.events = { messageCreate: failing };

  const i18n = new I18n('ru');
  registerCoreLocales(i18n);

  const services = {
    logger: testLogger,
    i18n,
    bus: new EventBus(testLogger),
    config: {
      isEnabled: vi.fn(async () => enabled),
      get: vi.fn(async () => ({ enabled, config: leveling.defaultConfig })),
    },
    redis: {
      set: vi.fn(async () => (cooldownFree ? 'OK' : null)),
      pttl: vi.fn(async () => 2500),
    },
  } as unknown as BotServices;

  const dispatcher = new Dispatcher(services, new ModuleRegistry([leveling, broken]));
  return { dispatcher, services, execute, onMessage, failing };
}

function chatInput(commandName: string) {
  return {
    id: 'i1',
    commandName,
    guildId: GUILD,
    locale: 'en-US',
    user: { id: '222222222222222222' },
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
  };
}

describe('Dispatcher events', () => {
  it('delivers events to enabled modules and isolates failures', async () => {
    const { dispatcher, onMessage, failing } = setup();
    const message = { guildId: GUILD };

    await dispatcher.dispatchEvent('messageCreate', [message]);

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ moduleId: 'leveling' }), message);
    expect(failing).toHaveBeenCalledOnce();
  });

  it('skips modules disabled for the guild', async () => {
    const { dispatcher, onMessage } = setup({ enabled: false });
    await dispatcher.dispatchEvent('messageCreate', [{ guildId: GUILD }]);
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('Dispatcher interactions', () => {
  it('executes commands with a localized context', async () => {
    const { dispatcher, execute } = setup();
    const interaction = chatInput('rank');

    await dispatcher.handleInteraction(interaction as never);

    expect(execute).toHaveBeenCalledWith(interaction, expect.objectContaining({ locale: 'en', moduleId: 'leveling' }));
  });

  it('replies when the module is disabled', async () => {
    const { dispatcher, execute } = setup({ enabled: false });
    const interaction = chatInput('rank');

    await dispatcher.handleInteraction(interaction as never);

    expect(execute).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'The “leveling” module is disabled on this server.' }),
    );
  });

  it('enforces cooldowns', async () => {
    const { dispatcher, execute } = setup({ cooldownFree: false });
    const interaction = chatInput('rank');

    await dispatcher.handleInteraction(interaction as never);

    expect(execute).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Please wait 3s before using this again.' }),
    );
  });

  it('routes unknown commands to the fallback handler of an enabled module', async () => {
    const fallback = vi.fn(async () => {});
    const custom = createTestModule('custom');
    custom.bot!.fallbackCommand = { execute: fallback };
    const { services } = setup();
    const dispatcher = new Dispatcher(services, new ModuleRegistry([custom]));
    const interaction = chatInput('my-dynamic-command');

    await dispatcher.handleInteraction(interaction as never);

    expect(fallback).toHaveBeenCalledWith(interaction, expect.objectContaining({ moduleId: 'custom', locale: 'en' }));
  });

  it('allows only one fallback handler', () => {
    const a = createTestModule('a-mod');
    const b = createTestModule('b-mod');
    a.bot!.fallbackCommand = { execute: async () => {} };
    b.bot!.fallbackCommand = { execute: async () => {} };
    expect(() => new ModuleRegistry([a, b])).toThrow(/Fallback command is already registered/);
  });

  it('reports command errors to the user', async () => {
    const { dispatcher, execute } = setup();
    execute.mockRejectedValueOnce(new Error('boom'));
    const interaction = chatInput('rank');

    await dispatcher.handleInteraction(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Something went wrong. Please try again later.' }),
    );
  });
});
