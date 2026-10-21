import { describe, expect, it } from 'vitest';
import { ScheduledInput } from './config.js';
import { nextRun } from './service.js';

describe('nextRun', () => {
  const from = new Date('2026-10-22T10:00:00Z');

  it('repeats after the interval and none for a one-off message', () => {
    expect(nextRun(from, 60, new Date('2026-10-22T10:00:30Z'))).toEqual(new Date('2026-10-22T11:00:00Z'));
    expect(nextRun(from, 0)).toBeNull();
  });

  it('skips the runs missed while the worker was down', () => {
    expect(nextRun(from, 60, new Date('2026-10-22T13:30:00Z'))).toEqual(new Date('2026-10-22T14:00:00Z'));
    expect(nextRun(from, 60, new Date('2026-10-22T13:00:00Z'))).toEqual(new Date('2026-10-22T14:00:00Z'));
  });
});

describe('ScheduledInput', () => {
  it('allows once or repeats from ten minutes', () => {
    const base = { channelId: '100000000000000001', message: { content: 'x' }, nextRunAt: '2026-10-22T10:00:00+03:00', enabled: true };
    expect(ScheduledInput.safeParse({ ...base, intervalMin: 0 }).success).toBe(true);
    expect(ScheduledInput.safeParse({ ...base, intervalMin: 5 }).success).toBe(false);
    expect(ScheduledInput.safeParse({ ...base, intervalMin: 1440 }).success).toBe(true);
  });
});
