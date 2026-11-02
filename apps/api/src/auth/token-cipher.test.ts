import { describe, expect, it } from 'vitest';
import { TokenCipher } from './token-cipher.js';

describe('TokenCipher', () => {
  const cipher = new TokenCipher('a-secret-that-is-long-enough-for-tests');

  it('round-trips tokens with a random IV', () => {
    const a = cipher.encrypt('discord-token');
    const b = cipher.encrypt('discord-token');

    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('discord-token');
  });

  it('rejects tampered payloads and other keys', () => {
    const payload = cipher.encrypt('discord-token');
    const [iv, tag, data] = payload.split('.');
    const changed = Buffer.from(data!, 'base64url');
    changed[0] = changed[0]! ^ 1;
    const tampered = [iv, tag, changed.toString('base64url')].join('.');

    expect(() => cipher.decrypt(tampered)).toThrow();
    expect(() => new TokenCipher('another-secret-that-is-long-enough').decrypt(payload)).toThrow();
  });

  it('requires the full authentication tag and rejects alternate encodings', () => {
    const payload = cipher.encrypt('discord-token');
    const [iv, tag, data] = payload.split('.');
    const truncated = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => cipher.decrypt([iv, truncated, data].join('.'))).toThrow();
    expect(() => cipher.decrypt(`${payload}.extra`)).toThrow();
    expect(() => cipher.decrypt(`${payload}!`)).toThrow();
    expect(cipher.decrypt(cipher.encrypt(''))).toBe('');
  });
});
