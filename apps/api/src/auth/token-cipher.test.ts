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
    const tampered = [iv, tag, `${data!.slice(0, -2)}AA`].join('.');

    expect(() => cipher.decrypt(tampered)).toThrow();
    expect(() => new TokenCipher('another-secret-that-is-long-enough').decrypt(payload)).toThrow();
  });
});
