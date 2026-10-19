import { ModuleRegistry } from '@bot/core';
import { I18n } from '@bot/i18n';
import { describe, expect, it } from 'vitest';
import { formatCommandList } from './commands/help.js';
import general from './index.js';

describe('general module', () => {
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

  it('formats the command list with localized descriptions', () => {
    const list = formatCommandList(
      [
        { id: '2', name: 'ping', description: 'Check bot latency', descriptionLocalizations: { ru: 'Проверить задержку бота' } },
        { id: '1', name: 'help', description: 'Show available commands', descriptionLocalizations: null },
      ],
      'ru',
    );
    expect(list).toBe('</help:1> — Show available commands\n</ping:2> — Проверить задержку бота');
  });
});
