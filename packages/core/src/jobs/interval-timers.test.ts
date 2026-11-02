import type { CoreServices } from '../context.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModuleRegistry } from '../registry.js';
import { createTestModule, testLogger } from '../testing/fixtures.js';
import { IntervalRunner } from './runner.js';

afterEach(() => vi.useRealTimers());

describe('interval timer lifecycle', () => {
  function setup() {
    const run = vi.fn(async () => {});
    const set = vi.fn(async (): Promise<string | null> => 'OK');
    const error = vi.fn();
    const registry = new ModuleRegistry([createTestModule('scheduled', { intervals: { poll: { everyMs: 1000, run } } })]);
    const services = { redis: { set, eval: vi.fn(async () => 1) }, logger: { error, child: () => testLogger } } as unknown as CoreServices;
    return { runner: new IntervalRunner(services, registry), run, set, error };
  }

  it('does not multiply polling timers on duplicate starts and releases them on stop', async () => {
    vi.useFakeTimers();
    const { runner, run } = setup();
    runner.start();
    runner.start();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    runner.stop();
    expect(vi.getTimerCount()).toBe(0);
    runner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it('handles failure to acquire a Redis lease and can run on the next interval', async () => {
    vi.useFakeTimers();
    const { runner, run, set, error } = setup();
    set.mockRejectedValueOnce(new Error('Redis unavailable'));
    runner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    runner.stop();
  });
});
