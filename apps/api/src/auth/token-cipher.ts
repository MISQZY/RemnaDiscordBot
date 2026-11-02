import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Encrypts OAuth tokens stored in Redis: AES-256-GCM with a key derived from SESSION_SECRET. */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`token-cipher:${secret}`).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part))) throw new Error('Malformed encrypted token');
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !encrypted ||
        [iv, tag, encrypted].some((part, i) => part.toString('base64url') !== parts[i])) throw new Error('Malformed encrypted token');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
