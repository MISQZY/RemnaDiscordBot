import { createTestRedis } from '@bot/testing';
import type { GuildSnapshotReader } from '@bot/discord';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordOAuth, DiscordTokens } from './discord-oauth.js';
import { SessionStore } from './sessions.js';
import { TokenCipher } from './token-cipher.js';
import { UserGuildService } from './user-guilds.js';

const initial = {
  userId: 'user', username: 'tester', globalName: null, avatar: null,
  accessToken: 'old', refreshToken: 'refresh', expiresAt: 0,
};
const tokens = { accessToken: 'fresh', refreshToken: 'renewed', expiresAt: Date.now() + 3_600_000 };

function setup(refresh: DiscordOAuth['refresh']) {
  const redis = createTestRedis();
  const sessions = new SessionStore(redis, new TokenCipher('test-session-secret-at-least-32-characters'));
  const oauth = { refresh } as DiscordOAuth;
  const service = new UserGuildService(redis, oauth, sessions, {} as GuildSnapshotReader);
  const replica = new UserGuildService(redis, oauth, sessions, {} as GuildSnapshotReader);
  return { sessions, service, replica };
}

describe('session refresh and revocation', () => {
  it('cannot restore a session logged out while Discord was refreshing', async () => {
    let release!: (value: DiscordTokens) => void;
    const refresh = vi.fn(() => new Promise<DiscordTokens>((resolve) => { release = resolve; }));
    const { sessions, service } = setup(refresh);
    const session = await sessions.create(initial);
    const pending = service.accessToken(session);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await sessions.destroy(session.id);
    release(tokens);
    await expect(pending).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await sessions.get(session.id)).toBeNull();
  });

  it('reuses tokens already refreshed by another request', async () => {
    const refresh = vi.fn();
    const { sessions, service } = setup(refresh);
    const stale = await sessions.create(initial);
    await sessions.save({ ...stale, ...tokens });
    expect(await service.accessToken(stale)).toBe('fresh');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shares one refresh across independent API replicas', async () => {
    let release!: (value: DiscordTokens) => void;
    const refresh = vi.fn(() => new Promise<DiscordTokens>((resolve) => { release = resolve; }));
    const { sessions, service, replica } = setup(refresh);
    const session = await sessions.create(initial);
    const first = service.accessToken({ ...session });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const second = replica.accessToken({ ...session });
    release(tokens);
    expect(await Promise.all([first, second])).toEqual(['fresh', 'fresh']);
    expect(refresh).toHaveBeenCalledOnce();
    expect(await sessions.get(session.id)).toMatchObject({ accessToken: 'fresh' });
  });
});
