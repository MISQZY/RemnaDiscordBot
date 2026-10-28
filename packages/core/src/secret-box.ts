import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Marks a sealed value; anything without it was stored before sealing and is read as it is. */
const PREFIX = 'sb1.';

/**
 * Seals secrets kept in the database (API keys of notification sources, webhook tokens): AES-256-GCM, the key derived
 * from a secret every process has. The first key seals; opening tries each, so a new key can come first while values
 * sealed with the old one are still read (and sealed anew when saved again).
 */
export class SecretBox {
  private readonly keys: Buffer[];

  constructor(secrets: string[]) {
    if (secrets.length === 0) throw new Error('SecretBox needs at least one secret');
    this.keys = secrets.map((secret) => createHash('sha256').update(`secret-box:${secret}`).digest());
  }

  /**
   * `SECRETS_KEY`, then `SECRETS_KEY_OLD` (while values move to a new key), then the bot token: every process has it,
   * so it does without `SECRETS_KEY`, but replacing it loses what only it opens.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox {
    const secrets = [env.SECRETS_KEY, env.SECRETS_KEY_OLD, env.DISCORD_TOKEN].filter((s): s is string => Boolean(s));
    if (secrets.length === 0) throw new Error('Set SECRETS_KEY (or DISCORD_TOKEN) to keep secrets');
    return new SecretBox(secrets);
  }

  static isSealed(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys[0]!, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  /** The plain value; a value stored before sealing comes back as it is. Throws when no key opens it. */
  open(value: string): string {
    return this.unseal(value).plain;
  }

  /**
   * The value sealed with the first key when it is not yet: plain, or sealed with a later one. `null` — it already is.
   * Throws when no key opens it.
   */
  reseal(value: string): string | null {
    const { plain, keyIndex } = this.unseal(value);
    return keyIndex === 0 ? null : this.seal(plain);
  }

  /** The plain value and the index of the key that opened it; -1 for a value stored before sealing. */
  private unseal(value: string): { plain: string; keyIndex: number } {
    if (!SecretBox.isSealed(value)) return { plain: value, keyIndex: -1 };
    const [iv, tag, encrypted] = value.slice(PREFIX.length).split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !encrypted) throw new Error('Malformed sealed value');
    for (const [keyIndex, key] of this.keys.entries()) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return { plain: Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'), keyIndex };
      } catch {
        // Sealed with another key: try the next.
      }
    }
    throw new Error('No key opens this sealed value — SECRETS_KEY or DISCORD_TOKEN changed');
  }
}
