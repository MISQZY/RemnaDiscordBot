import { I18n } from '@bot/i18n';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineModule } from '../module.js';
import { ModuleRegistry } from '../registry.js';
import { createTestModule, testLogger } from '../testing/fixtures.js';
import { MemoryConfigStore, MemorySharedCache } from '../testing/memory-config.js';
import { ConfigService, UnknownModuleError } from './service.js';

const GUILD = '111111111111111111';
const STORED_AT = '2026-10-01T00:00:00.000Z';

function setup(modules = [createTestModule('leveling')]) {
  const store = new MemoryConfigStore();
  const sharedCache = new MemorySharedCache();
  const publish = vi.fn(async () => {});
  const service = new ConfigService({
    registry: new ModuleRegistry(modules),
    store,
    sharedCache,
    publish,
    logger: testLogger,
  });
  return { service, store, sharedCache, publish };
}

describe('ConfigService', () => {
  it('returns defaults when nothing is stored', async () => {
    const { service } = setup();
    expect(await service.get(GUILD, 'leveling')).toEqual({
      enabled: false,
      config: { xpPerMessage: 10, announce: true },
      updatedAt: null,
    });
  });

  it('honours enabledByDefault and alwaysEnabled', async () => {
    const { service } = setup([
      createTestModule('leveling', { enabledByDefault: true }),
      createTestModule('general', { alwaysEnabled: true }),
    ]);
    await service.update(GUILD, 'general', { enabled: false });

    expect(await service.enabledModules(GUILD)).toEqual(['leveling', 'general']);
  });

  it('caches reads locally and in the shared cache', async () => {
    const { service, store, sharedCache } = setup();
    await service.get(GUILD, 'leveling');
    await service.get(GUILD, 'leveling');

    expect(store.finds).toBe(1);
    expect(sharedCache.entries.get(`${GUILD}:leveling`)).toBeNull();
  });

  it('validates, saves and publishes updates', async () => {
    const { service, store, publish } = setup();
    await service.get(GUILD, 'leveling');

    const updated = await service.update(GUILD, 'leveling', { enabled: true, config: { xpPerMessage: 20, announce: false } }, 'user');

    expect(updated).toEqual({ enabled: true, config: { xpPerMessage: 20, announce: false }, updatedAt: expect.any(String) });
    expect(store.rows.get(`${GUILD}:leveling`)).toEqual({
      enabled: true,
      config: { xpPerMessage: 20, announce: false },
      version: 1,
      updatedAt: updated.updatedAt,
    });
    expect(publish).toHaveBeenCalledWith({ guildId: GUILD, moduleId: 'leveling' });
    expect(await service.get(GUILD, 'leveling')).toEqual(updated);
  });

  it('rejects invalid configs on update', async () => {
    const { service, store } = setup();
    await expect(service.update(GUILD, 'leveling', { config: { xpPerMessage: -1, announce: true } })).rejects.toThrow();
    expect(store.rows.size).toBe(0);
  });

  it('falls back to defaults when stored config is invalid', async () => {
    const { service, store } = setup();
    store.rows.set(`${GUILD}:leveling`, { enabled: true, config: { broken: true }, version: 1, updatedAt: STORED_AT });

    expect(await service.get(GUILD, 'leveling')).toEqual({
      enabled: true,
      config: { xpPerMessage: 10, announce: true },
      updatedAt: STORED_AT,
    });
  });

  it('migrates configs stored with an older version', async () => {
    const module = createTestModule('leveling', {
      configVersion: 2,
      migrateConfig: (raw) => ({ ...(raw as object), announce: false }),
    });
    const { service, store } = setup([module]);
    store.rows.set(`${GUILD}:leveling`, { enabled: true, config: { xpPerMessage: 5 }, version: 1, updatedAt: STORED_AT });

    expect((await service.get(GUILD, 'leveling')).config).toEqual({ xpPerMessage: 5, announce: false });
  });

  it('drops local cache on invalidation', async () => {
    const { service, store, sharedCache } = setup();
    await service.get(GUILD, 'leveling');
    store.rows.set(`${GUILD}:leveling`, { enabled: true, config: { xpPerMessage: 15, announce: true }, version: 1, updatedAt: STORED_AT });
    sharedCache.entries.clear();

    service.invalidate({ guildId: GUILD });

    expect(await service.get(GUILD, 'leveling')).toEqual({
      enabled: true,
      config: { xpPerMessage: 15, announce: true },
      updatedAt: STORED_AT,
    });
  });

  it('localizes default texts to the guild language', async () => {
    const i18n = new I18n('ru');
    i18n.register('greeter', { ru: { defaults: { text: 'Привет, {user.mention}' } }, en: { defaults: { text: 'Hi {user.mention}' } } });
    const greeter = defineModule({
      id: 'greeter',
      configSchema: z.object({ text: z.string() }),
      defaultConfig: { text: 'static' },
      configVersion: 1,
      localizeDefaults: (defaults, t) => ({ ...defaults, text: t('defaults.text') }),
    });
    const service = new ConfigService({
      registry: new ModuleRegistry([greeter]),
      store: new MemoryConfigStore(),
      locales: { localeOf: async (guildId) => (guildId === GUILD ? 'en' : 'ru'), i18n },
      logger: testLogger,
    });

    expect((await service.get(GUILD, 'greeter')).config).toEqual({ text: 'Hi {user.mention}' });
    expect((await service.get('222222222222222222', 'greeter')).config).toEqual({ text: 'Привет, {user.mention}' });
    expect(await service.defaults(GUILD, 'greeter')).toEqual({ text: 'Hi {user.mention}' });
  });

  it('throws for unknown modules', async () => {
    const { service } = setup();
    await expect(service.get(GUILD, 'missing')).rejects.toBeInstanceOf(UnknownModuleError);
  });

  it('batch loads all modules in a single store lookup', async () => {
    const { service, store, sharedCache } = setup([
      createTestModule('mod1'),
      createTestModule('mod2'),
      createTestModule('mod3'),
    ]);
    store.rows.set(`${GUILD}:mod1`, { enabled: true, config: { xpPerMessage: 1, announce: false }, version: 1, updatedAt: STORED_AT });
    store.rows.set(`${GUILD}:mod2`, { enabled: true, config: { xpPerMessage: 2, announce: true }, version: 1, updatedAt: STORED_AT });

    const all = await service.getAll(GUILD);
    expect(all.size).toBe(3);
    expect(all.get('mod1')?.enabled).toBe(true);
    expect(all.get('mod2')?.enabled).toBe(true);
    expect(all.get('mod3')?.enabled).toBe(false);
    expect(store.finds).toBe(1);
    expect(sharedCache.entries.get(`${GUILD}:mod3`)).toBeNull();
  });
});
