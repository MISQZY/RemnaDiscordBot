import { ModuleRegistry } from '@bot/core';
import { modules } from '@bot/module-list';
import { describe, expect, it } from 'vitest';
import { collectCommandPayloads } from './commands.js';

describe('collectCommandPayloads', () => {
  it('serializes commands of all registered modules', () => {
    const payloads = collectCommandPayloads(new ModuleRegistry(modules));

    expect(payloads.map((p) => p.name).sort()).toEqual(['help', 'ping', 'welcome']);
    expect(payloads.find((p) => p.name === 'ping')).toMatchObject({
      description: 'Check bot latency',
      description_localizations: { ru: 'Проверить задержку бота' },
    });
  });
});
