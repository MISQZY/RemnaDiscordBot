import { ModuleRegistry } from '@bot/core';
import { I18n } from '@bot/i18n';
import { describe, expect, it, vi } from 'vitest';
import { helpSections } from './commands/help.js';
import { modules } from './commands/modules.js';
import general from './index.js';

const i18n = new I18n('ru');
new ModuleRegistry([general]).registerLocales(i18n);

describe('general module', () => {
  it('refuses module changes without ManageGuild before reading settings', async () => {
    const update = vi.fn();
    const interaction = {
      guildId: 'guild', memberPermissions: { has: () => false },
      options: { getSubcommand: () => 'disable' }, reply: vi.fn().mockResolvedValue(undefined),
    };
    await modules.execute(interaction as never, { t: (key: string) => key, config: { update } } as never);
    expect(update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'core.manageGuildRequired' }));
  });
  it('registers with valid defaults and commands', () => {
    const registry = new ModuleRegistry([general]);
    expect(registry.findCommand('ping')?.module.id).toBe('general');
    expect(registry.findCommand('help')?.module.id).toBe('general');
    expect(general.alwaysEnabled).toBe(true);
  });

  it('has matching locale keys', () => {
    const i18n = new I18n('ru');
    new ModuleRegistry([general]).registerLocales(i18n);
    expect(i18n.t('en', 'general.ping.reply', { ws: 10, roundtrip: 20 })).toBe(
      '🏓 Pong! Gateway: 10 ms · roundtrip: 20 ms',
    );
    expect(i18n.has('general.help.title', 'en')).toBe(true);
  });

  it('builds help from enabled modules with localized descriptions and mentions', () => {
    const sections = helpSections({
      modules: [general],
      enabled: new Set(['general', 'custom-commands']),
      commandIds: new Map([
        ['ping', '2'],
        ['modules', '3'],
      ]),
      extraCommands: [{ name: 'rules', description: 'Server rules' }],
      locale: 'ru',
      i18n,
      moduleName: (id) => ({ general: 'Основное', 'custom-commands': 'Свои команды' })[id] ?? id,
    });

    expect(sections.map((s) => s.title)).toEqual(['Основное', 'Свои команды']);
    expect(sections[0]!.lines).toEqual([
      '</ping:2> — Проверить задержку бота',
      '`/help` — Показать доступные команды',
      '</modules list:3> — Показать модули и их состояние',
      '</modules enable:3> — Включить модуль',
      '</modules disable:3> — Выключить модуль',
      '`/language` — Язык сервера для публичных сообщений бота',
    ]);
    expect(sections[1]!.lines).toEqual(['`/rules` — Server rules']);
  });

  it('hides commands of disabled modules', () => {
    const sections = helpSections({
      modules: [general],
      enabled: new Set(),
      commandIds: new Map(),
      extraCommands: [],
      locale: 'en-US',
      i18n,
      moduleName: (id) => id,
    });
    expect(sections).toEqual([]);
  });
});
