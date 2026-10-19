import { describe, expect, it } from 'vitest';
import { defaultLevelingConfig } from './config.js';
import { levelFromXp, levelProgress, progressBar, totalXpForLevel, xpToNextLevel } from './formula.js';
import { messageXp, rewardChanges } from './service.js';

describe('formula', () => {
  it('follows 5L² + 50L + 100', () => {
    expect(xpToNextLevel(0)).toBe(100);
    expect(xpToNextLevel(1)).toBe(155);
    expect(totalXpForLevel(2)).toBe(255);
  });

  it('derives level and progress from total XP', () => {
    expect(levelFromXp(0)).toBe(0);
    expect(levelFromXp(99)).toBe(0);
    expect(levelFromXp(100)).toBe(1);
    expect(levelFromXp(255)).toBe(2);
    expect(levelProgress(300)).toEqual({ level: 2, current: 45, needed: 220 });
  });

  it('draws a progress bar', () => {
    expect(progressBar(50, 100, 10)).toBe('█████░░░░░');
  });
});

describe('rewardChanges', () => {
  const rewards = [
    { level: 5, roleId: 'r5' },
    { level: 10, roleId: 'r10' },
    { level: 20, roleId: 'r20' },
  ];

  it('stacks rewards for all reached levels', () => {
    expect(rewardChanges(12, { rewards, stackRewards: true })).toEqual({ add: ['r5', 'r10'], remove: ['r20'] });
  });

  it('keeps only the highest reward when not stacking', () => {
    expect(rewardChanges(12, { rewards, stackRewards: false })).toEqual({ add: ['r10'], remove: ['r5', 'r20'] });
    expect(rewardChanges(1, { rewards, stackRewards: false })).toEqual({ add: [], remove: ['r5', 'r10', 'r20'] });
  });
});

describe('messageXp', () => {
  const config = {
    xpPerMessage: { min: 10, max: 20 },
    multipliers: [
      { type: 'role' as const, id: 'booster', value: 2 },
      { type: 'role' as const, id: 'vip', value: 1.5 },
      { type: 'channel' as const, id: 'spam', value: 0 },
    ],
  };

  it('picks a random base within the range', () => {
    expect(messageXp(config, { roleIds: [], channelId: 'c' }, () => 0)).toBe(10);
    expect(messageXp(config, { roleIds: [], channelId: 'c' }, () => 0.999)).toBe(20);
  });

  it('applies the highest role multiplier and the channel multiplier', () => {
    expect(messageXp(config, { roleIds: ['vip', 'booster'], channelId: 'c' }, () => 0)).toBe(20);
    expect(messageXp(config, { roleIds: ['booster'], channelId: 'spam' }, () => 0)).toBe(0);
  });

  it('has valid defaults', () => {
    expect(defaultLevelingConfig.xpPerMessage.min).toBeLessThanOrEqual(defaultLevelingConfig.xpPerMessage.max);
  });
});
