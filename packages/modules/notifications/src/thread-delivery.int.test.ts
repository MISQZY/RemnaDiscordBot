import type { ModuleServices } from '@bot/core';
import { I18n } from '@bot/i18n';
import { createLogger } from '@bot/logger';
import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSubscription } from '@bot/db';
import type { NotificationsConfig } from './config.js';
import { locales } from './locales.js';
import { deliver } from './poll.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000002';
const otherChannel = '200000000000000003';
const item = (id: string) => ({ id, vars: { title: id }, text: id });
const discordError = (code: number) => new DiscordAPIError({ message: 'Discord refused', code }, code, 404, 'GET', '/channels/thread', {});

describe('persistent subscription threads', () => {
  let database: TestDatabase;
  let row: NotificationSubscription;
  let ctx: ModuleServices<NotificationsConfig>;
  let threadSequence = 0;
  const post = vi.fn(async (route: string, _options?: unknown): Promise<{ id: string }> => {
    return { id: route.endsWith('/threads') ? String(900000000000000000n + BigInt(++threadSequence)) : '800000000000000001' };
  });
  const get = vi.fn(async () => ({ guild_id: GUILD, parent_id: CHANNEL, thread_metadata: { archived: false, locked: false } }));
  const patch = vi.fn(async () => ({}));
  const remove = vi.fn(async () => ({}));

  beforeAll(async () => { database = await createTestDatabase(); });
  afterAll(async () => { await database.cleanup(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    get.mockResolvedValue({ guild_id: GUILD, parent_id: CHANNEL, thread_metadata: { archived: false, locked: false } });
    const source = await database.db.notificationSource.create({ data: { provider: 'webhook', externalId: String(Date.now()) + Math.random(), name: 'Source updates' } });
    row = await database.db.notificationSubscription.create({ data: {
      guildId: GUILD, sourceId: source.id, channelId: CHANNEL, deliveryMode: 'thread', message: { content: '{title}' },
    } });
    const i18n = new I18n('en');
    i18n.register('notifications', locales);
    ctx = {
      db: database.db, redis: createTestRedis(), i18n,
      rest: { post, get, patch, delete: remove },
      guildLocales: { get: async () => 'en' },
      config: { isEnabled: async () => true },
      logger: createLogger({ service: 'thread-test', level: 'silent', pretty: false }),
    } as unknown as ModuleServices<NotificationsConfig>;
  });

  it('creates one thread and reuses it even when the caller has an older row', async () => {
    expect(await deliver(ctx, row, item('first'))).toBe('posted');
    const saved = await database.db.notificationSubscription.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.threadId).not.toBeNull();
    expect(await deliver(ctx, row, item('second'))).toBe('posted');
    expect(post.mock.calls.filter(([route]) => route.endsWith('/threads'))).toHaveLength(1);
    expect(post.mock.calls.filter(([route]) => route === `/channels/${saved.threadId}/messages`)).toHaveLength(2);
    expect(post.mock.calls.filter(([route]) => route === `/channels/${CHANNEL}/messages`)).toHaveLength(1);
  });

  it('does not create duplicate threads for concurrent announcements', async () => {
    expect(await Promise.all([deliver(ctx, row, item('first')), deliver(ctx, row, item('second'))])).toEqual(['posted', 'posted']);
    expect(post.mock.calls.filter(([route]) => route.endsWith('/threads'))).toHaveLength(1);
  });

  it('reopens an archived thread without replacing it', async () => {
    await deliver(ctx, row, item('first'));
    get.mockResolvedValueOnce({ guild_id: GUILD, parent_id: CHANNEL, thread_metadata: { archived: true, locked: false } });
    expect(await deliver(ctx, row, item('second'))).toBe('posted');
    expect(patch).toHaveBeenCalledWith(expect.stringMatching(/^\/channels\//), { body: { archived: false } });
    expect(post.mock.calls.filter(([route]) => route.endsWith('/threads'))).toHaveLength(1);
  });

  it('creates a replacement when the saved thread was deleted', async () => {
    await deliver(ctx, row, item('first'));
    const first = await database.db.notificationSubscription.findUniqueOrThrow({ where: { id: row.id } });
    get.mockRejectedValueOnce(discordError(RESTJSONErrorCodes.UnknownChannel));
    expect(await deliver(ctx, row, item('second'))).toBe('posted');
    const second = await database.db.notificationSubscription.findUniqueOrThrow({ where: { id: row.id } });
    expect(second.threadId).not.toBe(first.threadId);
    expect(post.mock.calls.filter(([route]) => route.endsWith('/threads'))).toHaveLength(2);
  });

  it('respects locked threads and does not post the notification in the parent instead', async () => {
    await deliver(ctx, row, item('first'));
    post.mockClear();
    get.mockResolvedValueOnce({ guild_id: GUILD, parent_id: CHANNEL, thread_metadata: { archived: true, locked: true } });
    expect(await deliver(ctx, row, item('second'))).toBe('noAccess');
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects a stored thread outside the selected channel', async () => {
    await deliver(ctx, row, item('first'));
    post.mockClear();
    get.mockResolvedValueOnce({ guild_id: GUILD, parent_id: otherChannel, thread_metadata: { archived: false, locked: false } });
    expect(await deliver(ctx, row, item('second'))).toBe('noAccess');
    expect(post).not.toHaveBeenCalled();
  });

  it('does not send a pending threaded notification to the old destination after a settings change', async () => {
    await database.db.notificationSubscription.update({ where: { id: row.id }, data: { channelId: otherChannel, deliveryMode: 'channel', threadId: null } });
    expect(await deliver(ctx, row, item('first'))).toBe('posted');
    expect(post.mock.calls.map(([route]) => route)).toEqual([`/channels/${otherChannel}/messages`]);
  });
  it('removes the parent starter when Discord refuses to create the thread', async () => {
    post.mockResolvedValueOnce({ id: '800000000000000002' }).mockRejectedValueOnce(discordError(RESTJSONErrorCodes.MissingPermissions));
    expect(await deliver(ctx, row, item('first'))).toBe('noAccess');
    expect(remove).toHaveBeenCalledWith(`/channels/${CHANNEL}/messages/800000000000000002`);
    const saved = await database.db.notificationSubscription.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.threadId).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('discards a new thread when the destination changes while Discord creates it', async () => {
    post.mockResolvedValueOnce({ id: '800000000000000003' }).mockImplementationOnce(async () => {
      await database.db.notificationSubscription.update({ where: { id: row.id }, data: { channelId: otherChannel } });
      return { id: '900000000000000099' };
    });
    expect(await deliver(ctx, row, item('first'))).toBe('failed');
    expect(remove).toHaveBeenCalledWith('/channels/900000000000000099');
    const saved = await database.db.notificationSubscription.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved).toMatchObject({ channelId: otherChannel, threadId: null });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('does not send to the old thread when settings change during its lookup', async () => {
    await deliver(ctx, row, item('first'));
    post.mockClear();
    get.mockImplementationOnce(async () => {
      await database.db.notificationSubscription.update({ where: { id: row.id }, data: { channelId: otherChannel, threadId: null } });
      return { guild_id: GUILD, parent_id: CHANNEL, thread_metadata: { archived: false, locked: false } };
    });
    expect(await deliver(ctx, row, item('second'))).toBe('failed');
    expect(post).not.toHaveBeenCalled();
  });

});
