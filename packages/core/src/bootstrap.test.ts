import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testLogger } from './testing/fixtures.js';

const mock = vi.hoisted(() => ({
  unsubscribe: vi.fn(), stopVip: vi.fn(), quit: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('@bot/db', () => ({ createDatabaseClient: async () => ({ $disconnect: mock.disconnect }) }));
vi.mock('ioredis', () => ({ Redis: class {
  on() { return this; }
  quit = mock.quit;
} }));
vi.mock('./vip/access.js', () => ({ VipAccess: class {
  async start() { return mock.stopVip; }
} }));
vi.mock('./config/pubsub.js', () => ({
  publishConfigInvalidation: vi.fn(),
  subscribeConfigInvalidation: async () => mock.unsubscribe,
}));

import { bootstrapServices } from './bootstrap.js';

beforeEach(() => {
  vi.resetAllMocks();
  mock.unsubscribe.mockResolvedValue(undefined);
  mock.stopVip.mockResolvedValue(undefined);
  mock.quit.mockResolvedValue('OK');
  mock.disconnect.mockResolvedValue(undefined);
});

describe('bootstrap shutdown', () => {
  it('waits for both subscriptions before closing the shared connections', async () => {
    let release!: () => void;
    mock.unsubscribe.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    const services = await bootstrapServices({ databaseUrl: 'test', redisUrl: 'test', modules: [], logger: testLogger });
    const closing = services.close();
    expect(mock.stopVip).toHaveBeenCalledOnce();
    expect(mock.quit).not.toHaveBeenCalled();
    release();
    await closing;
    expect(mock.quit).toHaveBeenCalledOnce();
    expect(mock.disconnect).toHaveBeenCalledOnce();
  });

  it('still closes connections and reports a subscriber failure', async () => {
    const error = new Error('unsubscribe failed');
    mock.unsubscribe.mockRejectedValueOnce(error);
    const services = await bootstrapServices({ databaseUrl: 'test', redisUrl: 'test', modules: [], logger: testLogger });
    await expect(services.close()).rejects.toMatchObject({ errors: [error] });
    expect(mock.stopVip).toHaveBeenCalledOnce();
    expect(mock.quit).toHaveBeenCalledOnce();
    expect(mock.disconnect).toHaveBeenCalledOnce();
  });
});
