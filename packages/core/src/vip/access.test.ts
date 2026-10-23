import { describe, expect, it } from 'vitest';
import { ConfigService } from '../config/service.js';
import { ModuleRegistry } from '../registry.js';
import { createTestModule, testLogger } from '../testing/fixtures.js';
import { MemoryConfigStore } from '../testing/memory-config.js';
import { VipAccess } from './access.js';

const GUILD = '111111111111111111';
const OTHER = '222222222222222222';
const NOW = Date.parse('2026-10-24T00:00:00.000Z');

describe('VipAccess', () => {
  const vip = new VipAccess();
  vip.set({
    modules: ['music'],
    guilds: [
      { guildId: GUILD, expiresAt: '2026-10-25T00:00:00.000Z' },
      { guildId: OTHER, expiresAt: null },
    ],
  });

  it('tells active VIP from expired and absent', () => {
    expect(vip.of(GUILD, NOW)).toEqual({ expiresAt: '2026-10-25T00:00:00.000Z' });
    expect(vip.of(OTHER, NOW)).toEqual({ expiresAt: null });
    expect(vip.of(GUILD, Date.parse('2026-10-25T00:00:00.000Z'))).toBeNull();
    expect(vip.of('333333333333333333', NOW)).toBeNull();
  });

  it('locks only VIP modules in guilds without VIP', () => {
    expect(vip.locked(GUILD, 'music', NOW)).toBe(false);
    expect(vip.locked('333333333333333333', 'music', NOW)).toBe(true);
    expect(vip.locked('333333333333333333', 'leveling', NOW)).toBe(false);
  });
});

describe('ConfigService with VIP', () => {
  function setup() {
    const vip = new VipAccess();
    vip.set({ modules: ['music'], guilds: [] });
    const store = new MemoryConfigStore();
    const service = new ConfigService({
      registry: new ModuleRegistry([createTestModule('music'), createTestModule('leveling')]),
      store,
      vip,
      logger: testLogger,
    });
    return { service, store, vip };
  }

  it('refuses to enable a VIP module without VIP', async () => {
    const { service } = setup();
    await expect(service.update(GUILD, 'music', { enabled: true })).rejects.toMatchObject({ code: 'VIP_REQUIRED' });
    expect((await service.update(GUILD, 'leveling', { enabled: true })).enabled).toBe(true);
  });

  it('reads a VIP module as disabled once VIP is gone, and keeps it on for when it is back', async () => {
    const { service, store, vip } = setup();
    vip.set({ modules: ['music'], guilds: [{ guildId: GUILD, expiresAt: null }] });
    await service.update(GUILD, 'music', { enabled: true });
    expect(await service.isEnabled(GUILD, 'music')).toBe(true);

    vip.set({ modules: ['music'], guilds: [] });
    expect(await service.isEnabled(GUILD, 'music')).toBe(false);
    expect(service.vipLocked(GUILD, 'music')).toBe(true);

    // Saving the config while locked does not switch it off for good.
    await service.update(GUILD, 'music', { config: { xpPerMessage: 20, announce: true } });
    expect(store.rows.get(`${GUILD}:music`)?.enabled).toBe(true);

    vip.set({ modules: ['music'], guilds: [{ guildId: GUILD, expiresAt: null }] });
    expect(await service.isEnabled(GUILD, 'music')).toBe(true);
  });
});
