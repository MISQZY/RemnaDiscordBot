import { describe, expect, it } from 'vitest';
import { defaultVerificationConfig, VerificationConfig } from './config.js';
import { CAPTCHA_EMOJIS, isVerified, makeChallenge } from './service.js';

describe('verification', () => {
  it('builds a captcha of five distinct emojis with the answer among them', () => {
    let seed = 0.37;
    const random = () => (seed = (seed * 9301 + 0.49297) % 1);
    const { options, answer } = makeChallenge(random);
    expect(options).toHaveLength(5);
    expect(new Set(options).size).toBe(5);
    expect(options.every((o) => (CAPTCHA_EMOJIS as readonly string[]).includes(o))).toBe(true);
    expect(answer).toBeGreaterThanOrEqual(0);
    expect(answer).toBeLessThan(5);
  });

  it('tells a verified member by the role or by the missing unverified role', () => {
    expect(isVerified(new Set(['v']), { roleId: 'v', unverifiedRoleId: 'u' })).toBe(true);
    expect(isVerified(new Set(['u']), { roleId: 'v', unverifiedRoleId: 'u' })).toBe(false);
    expect(isVerified(new Set([]), { roleId: null, unverifiedRoleId: 'u' })).toBe(true);
    expect(isVerified(new Set([]), { roleId: null, unverifiedRoleId: null })).toBe(false);
  });

  it('has valid defaults and refuses an empty button', () => {
    expect(VerificationConfig.parse(defaultVerificationConfig)).toEqual(defaultVerificationConfig);
    expect(VerificationConfig.safeParse({ ...defaultVerificationConfig, panel: { ...defaultVerificationConfig.panel, buttonLabel: ' ' } }).success).toBe(false);
  });
});
