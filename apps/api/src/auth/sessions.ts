import { randomBytes } from 'node:crypto';
import { RedisKeys } from '@bot/core';
import type { Redis } from 'ioredis';
import type { TokenCipher } from './token-cipher.js';

export interface Session {
  id: string;
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  accessToken: string;
  refreshToken: string;
  /** Discord access token expiry, ms. */
  expiresAt: number;
}

const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** Sessions in Redis: the API is stateless and replicas share sessions. Tokens are stored encrypted. */
export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly cipher: TokenCipher,
    readonly ttlSec = SESSION_TTL_SEC,
  ) {}

  async create(data: Omit<Session, 'id'>): Promise<Session> {
    const session = { ...data, id: randomBytes(32).toString('base64url') };
    await this.save(session);
    return session;
  }

  async get(id: string): Promise<Session | null> {
    const raw = await this.redis.get(RedisKeys.session(id));
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as Session;
      return {
        ...stored,
        accessToken: this.cipher.decrypt(stored.accessToken),
        refreshToken: this.cipher.decrypt(stored.refreshToken),
      };
    } catch {
      // SESSION_SECRET changed or the entry is corrupted — treat it as no session.
      await this.destroy(id);
      return null;
    }
  }

  /** Saves the session and extends it (sliding expiration). */
  async save(session: Session): Promise<void> {
    const stored = {
      ...session,
      accessToken: this.cipher.encrypt(session.accessToken),
      refreshToken: this.cipher.encrypt(session.refreshToken),
    };
    await this.redis.set(RedisKeys.session(session.id), JSON.stringify(stored), 'EX', this.ttlSec);
  }

  async destroy(id: string): Promise<void> {
    await this.redis.del(RedisKeys.session(id));
  }
}
