import { describe, expect, it, vi } from 'vitest';
import { ModuleRegistry } from '../registry.js';
import { createTestModule, testLogger } from '../testing/fixtures.js';
import { MemoryConfigStore, MemorySharedCache } from '../testing/memory-config.js';
import { ConfigService, UnknownModuleError } from './service.js';

const GUILD = '111111111111111111';

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

    expect(updated).toEqual({ enabled: true, config: { xpPerMessage: 20, announce: false } });
    expect(store.rows.get(`${GUILD}:leveling`)).toEqual({
      enabled: true,
      config: { xpPerMessage: 20, announce: false },
      version: 1,
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
    store.rows.set(`${GUILD}:leveling`, { enabled: true, config: { broken: true }, version: 1 });

    expect(await service.get(GUILD, 'leveling')).toEqual({
      enabled: true,
      config: { xpPerMessage: 10, announce: true },
    });
  });

  it('migrates configs stored with an older version', async () => {
    const module = createTestModule('leveling', {
      configVersion: 2,
      migrateConfig: (raw) => ({ ...(raw as object), announce: false }),
    });
    const { service, store } = setup([module]);
    store.rows.set(`${GUILD}:leveling`, { enabled: true, config: { xpPerMessage: 5 }, version: 1 });

    expect((await service.get(GUILD, 'leveling')).config).toEqual({ xpPerMessage: 5, announce: false });
  });

  it('drops local cache on invalidation', async () => {
    const { service, store, sharedCache } = setup();
    await service.get(GUILD, 'leveling');
    store.rows.set(`${GUILD}:leveling`, { enabled: true, config: { xpPerMessage: 15, announce: true }, version: 1 });
    sharedCache.entries.clear();

    service.invalidate({ guildId: GUILD });

    expect(await service.get(GUILD, 'leveling')).toEqual({
      enabled: true,
      config: { xpPerMessage: 15, announce: true },
    });
  });

  it('throws for unknown modules', async () => {
    const { service } = setup();
    await expect(service.get(GUILD, 'missing')).rejects.toBeInstanceOf(UnknownModuleError);
  });
});
