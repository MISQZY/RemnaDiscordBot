import { GatewayIntentBits, Partials } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './bus.js';
import { ModuleRegistry } from './registry.js';
import { createTestModule, testLogger } from './testing/fixtures.js';

describe('ModuleRegistry', () => {
  it('indexes commands, components and events', () => {
    const registry = new ModuleRegistry([createTestModule('leveling'), createTestModule('welcome')]);

    expect(registry.all().map((m) => m.id)).toEqual(['leveling', 'welcome']);
    expect(registry.findCommand('leveling-rank')?.module.id).toBe('leveling');
    expect(registry.findComponent('welcome-btn:test:1')?.module.id).toBe('welcome');
    expect(registry.subscribers('messageCreate')).toHaveLength(2);
    expect(registry.subscribedEvents()).toEqual(['messageCreate']);
  });

  it('finds context menu commands by type and name and refuses duplicates', () => {
    const menu = (type: 2 | 3, name: string) => ({ key: name, data: { name, toJSON: () => ({ type, name }) }, async execute() {} });
    const leveling = createTestModule('leveling');
    leveling.bot!.contextMenus = [menu(2, 'Report'), menu(3, 'Report')];
    const registry = new ModuleRegistry([leveling]);

    expect(registry.findContextMenu(2, 'Report')?.module.id).toBe('leveling');
    expect(registry.findContextMenu(3, 'Report')).toBeDefined();
    expect(registry.allContextMenus()).toHaveLength(2);

    const welcome = createTestModule('welcome');
    welcome.bot!.contextMenus = [menu(2, 'Report')];
    expect(() => registry.register(welcome)).toThrow(/already registered/);
  });

  it('merges gateway intents of all modules', () => {
    const leveling = createTestModule('leveling');
    leveling.bot!.intents = [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent];
    const welcome = createTestModule('welcome');
    welcome.bot!.intents = [GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages];

    const intents = new ModuleRegistry([leveling, welcome]).intents([GatewayIntentBits.Guilds]);

    expect(intents.sort()).toEqual(
      [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ].sort(),
    );
  });

  it('merges partials of all modules', () => {
    const a = createTestModule('leveling');
    a.bot!.partials = [Partials.Message, Partials.Channel];
    const b = createTestModule('welcome');
    b.bot!.partials = [Partials.Message];

    expect(new ModuleRegistry([a, b]).partials()).toEqual([Partials.Message, Partials.Channel]);
  });

  it('rejects duplicate and invalid module ids', () => {
    expect(() => new ModuleRegistry([createTestModule('leveling'), createTestModule('leveling')])).toThrow(
      /already registered/,
    );
    expect(() => new ModuleRegistry([createTestModule('Leveling')])).toThrow(/Invalid module id/);
  });

  it('rejects command name clashes between modules', () => {
    const other = createTestModule('other');
    other.bot!.commands![0]!.data = { name: 'leveling-rank', toJSON: () => ({ name: 'leveling-rank', description: 'x' }) };
    expect(() => new ModuleRegistry([createTestModule('leveling'), other])).toThrow(/\/leveling-rank/);
  });

  it('rejects invalid default config', () => {
    const broken = createTestModule('broken', { defaultConfig: { xpPerMessage: 0, announce: true } });
    expect(() => new ModuleRegistry([broken])).toThrow(/invalid defaultConfig/);
  });
});

describe('EventBus', () => {
  it('delivers events and isolates handler failures', async () => {
    const bus = new EventBus(testLogger);
    const received: unknown[] = [];
    const emitter = bus as unknown as { on(e: string, h: (p: unknown) => void): () => void; emit(e: string, p: unknown): Promise<void> };

    emitter.on('test.event', () => {
      throw new Error('boom');
    });
    const off = emitter.on('test.event', (payload) => void received.push(payload));

    await emitter.emit('test.event', { n: 1 });
    off();
    await emitter.emit('test.event', { n: 2 });

    expect(received).toEqual([{ n: 1 }]);
  });

  it('logs failed handlers', async () => {
    const logger = { error: vi.fn() };
    const bus = new EventBus(logger as never) as unknown as { on(e: string, h: () => void): void; emit(e: string, p: unknown): Promise<void> };
    bus.on('x', () => {
      throw new Error('boom');
    });
    await bus.emit('x', {});
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
