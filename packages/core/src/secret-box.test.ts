import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  it('seals so that only its keys open, differently every time', () => {
    const box = new SecretBox(['key-one']);
    const sealed = box.seal('Bearer secret');

    expect(sealed).toMatch(/^sb1\./);
    expect(sealed).not.toContain('secret');
    expect(box.seal('Bearer secret')).not.toBe(sealed);
    expect(box.open(sealed)).toBe('Bearer secret');
    expect(() => new SecretBox(['other']).open(sealed)).toThrow('No key opens');
  });

  it('opens values of an older key kept after the new one, and seals with the new one', () => {
    const old = new SecretBox(['token']).seal('v');
    const rotated = new SecretBox(['new-key', 'token']);

    expect(rotated.open(old)).toBe('v');
    expect(new SecretBox(['new-key']).open(rotated.seal('v'))).toBe('v');
  });

  it('reseals plain values and ones of a later key, and leaves ones of the first key', () => {
    const box = new SecretBox(['new-key', 'token']);
    const current = box.seal('v');
    const resealed = box.reseal(new SecretBox(['token']).seal('v'))!;

    expect(box.reseal(current)).toBeNull();
    expect(new SecretBox(['new-key']).open(resealed)).toBe('v');
    expect(new SecretBox(['new-key']).open(box.reseal('plain')!)).toBe('plain');
    expect(() => box.reseal(new SecretBox(['lost']).seal('v'))).toThrow('No key opens');
  });

  it('reads values stored before sealing as they are', () => {
    expect(new SecretBox(['k']).open('plain-token')).toBe('plain-token');
    expect(() => new SecretBox(['k']).open('sb1.broken')).toThrow('Malformed');
  });

  it('takes SECRETS_KEY first, then SECRETS_KEY_OLD and the bot token', () => {
    const sealed = new SecretBox(['from-token']).seal('v');
    const env = { SECRETS_KEY: 'k'.repeat(32), SECRETS_KEY_OLD: 'o'.repeat(32), DISCORD_TOKEN: 'from-token' };
    expect(SecretBox.fromEnv(env).open(sealed)).toBe('v');
    expect(SecretBox.fromEnv(env).open(new SecretBox(['o'.repeat(32)]).seal('w'))).toBe('w');
    expect(new SecretBox(['k'.repeat(32)]).open(SecretBox.fromEnv(env).seal('x'))).toBe('x');
    expect(() => SecretBox.fromEnv({})).toThrow('SECRETS_KEY');
  });
});
