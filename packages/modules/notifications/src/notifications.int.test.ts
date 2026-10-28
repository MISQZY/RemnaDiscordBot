import type { ModuleServices } from '@bot/core';
import { createLogger } from '@bot/logger';
import { createTestDatabase, type TestDatabase } from '@bot/testing';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NotificationsConfig } from './config.js';
import { pollProvider } from './poll.js';
import { SourceFailure, type FeedItem, type FeedResult, type Provider } from './providers.js';

const video = (id: string): FeedItem => ({ id, vars: { 'video.title': `Video ${id}`, 'video.url': `https://yt/${id}`, 'channel.name': 'Chan' } });

describe('pollProvider', () => {
  let database: TestDatabase;
  let feed: FeedResult = [];
  const provider: Provider = {
    id: 'youtube',
    lookup: vi.fn(),
    latest: async (ids) => new Map(ids.map((id) => [id, feed])),
  };
  const source = () => database.db.notificationSource.findFirstOrThrow();
  const post = vi.fn(async (_route: string, _options: { body: { content: string } }) => ({}));
  let ctx: ModuleServices<NotificationsConfig>;

  beforeAll(async () => {
    database = await createTestDatabase();
    const source = await database.db.notificationSource.create({ data: { provider: 'youtube', externalId: 'UC1', name: 'Chan' } });
    await database.db.notificationSubscription.createMany({
      data: [
        { guildId: '1', sourceId: source.id, channelId: '10', message: { content: '{video.title}' } },
        { guildId: '2', sourceId: source.id, channelId: '20', message: { content: '{video.title}' }, enabled: false },
        { guildId: '3', sourceId: source.id, channelId: '30', message: { content: '{video.title}' } },
      ],
    });
    ctx = {
      db: database.db,
      rest: { post },
      guildLocales: { get: async () => 'en' },
      logger: createLogger({ service: 'test', level: 'silent', pretty: false }),
      // The module is enabled in every guild except the third one.
      config: { isEnabled: async (guildId: string) => guildId !== '3' },
    } as unknown as ModuleServices<NotificationsConfig>;
  });

  afterAll(async () => {
    await database.cleanup();
  });

  it('only remembers the items on the first check', async () => {
    feed = [video('v2'), video('v1')];

    expect(await pollProvider(ctx, provider)).toBe(0);
    expect(await source()).toMatchObject({ seenIds: ['v2', 'v1'], lastError: null, failures: 0 });
    expect((await source()).lastSuccessAt).not.toBeNull();
  });

  it('announces new items oldest first to enabled subscriptions only', async () => {
    feed = [video('v4'), video('v3'), video('v2'), video('v1')];

    expect(await pollProvider(ctx, provider)).toBe(2);
    expect(post.mock.calls.map(([route, { body }]) => [route, body.content])).toEqual([
      ['/channels/10/messages', 'Video v3'],
      ['/channels/10/messages', 'Video v4'],
    ]);
  });

  it('does not repeat announcements', async () => {
    post.mockClear();
    expect(await pollProvider(ctx, provider)).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('announces nothing when the newest item is deleted and an older one comes back', async () => {
    feed = [video('v3'), video('v2'), video('v1'), video('v0')];

    expect(await pollProvider(ctx, provider)).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('records a failed check and puts the source off after repeated failures', async () => {
    feed = new SourceFailure('notFound', 'gone');

    await pollProvider(ctx, provider);
    expect(await source()).toMatchObject({ lastError: 'notFound', failures: 1 });
    // A single failure is retried as usual.
    expect((await source()).nextCheckAt!.getTime()).toBeLessThanOrEqual(Date.now());

    await pollProvider(ctx, provider);
    expect((await source()).failures).toBe(2);
    expect((await source()).nextCheckAt!.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: the provider is not asked again.
    await pollProvider(ctx, provider);
    expect((await source()).failures).toBe(2);
  });

  it('clears the failure after a successful check and records failed deliveries', async () => {
    await database.db.notificationSource.updateMany({ data: { nextCheckAt: null } });
    feed = [video('v5'), video('v4')];
    post
      .mockClear()
      .mockRejectedValueOnce(
        new DiscordAPIError({ code: RESTJSONErrorCodes.MissingPermissions, message: 'Missing Permissions' }, RESTJSONErrorCodes.MissingPermissions, 403, 'POST', '/x', {}),
      );

    // v4 was seen before the failures, only v5 is new.
    expect(await pollProvider(ctx, provider)).toBe(0);
    expect(await source()).toMatchObject({ lastError: null, failures: 0, nextCheckAt: null });
    expect((await source()).seenIds).toEqual(expect.arrayContaining(['v5', 'v4', 'v3']));
    const subscription = () => database.db.notificationSubscription.findFirstOrThrow({ where: { guildId: '1' } });
    expect((await subscription()).deliveryError).toBe('noAccess');

    feed = [video('v6'), video('v5')];
    expect(await pollProvider(ctx, provider)).toBe(1);
    expect((await subscription()).deliveryError).toBeNull();
    expect((await subscription()).deliveredAt).not.toBeNull();

    feed = [video('v7'), video('v6')];
    post.mockRejectedValueOnce(new DiscordAPIError({ code: RESTJSONErrorCodes.UnknownChannel, message: 'Unknown Channel' }, RESTJSONErrorCodes.UnknownChannel, 404, 'POST', '/x', {}));
    expect(await pollProvider(ctx, provider)).toBe(0);
    expect((await subscription()).deliveryError).toBe('channelNotFound');
  });

  it('announces only the items that pass the subscription filter', async () => {
    await database.db.notificationSubscription.updateMany({ where: { guildId: '1' }, data: { filter: { include: [], exclude: ['#shorts'] } } });
    feed = [{ ...video('v9'), text: 'Long video' }, { ...video('v8'), text: 'Funny #Shorts' }, video('v7')];
    post.mockClear();

    expect(await pollProvider(ctx, provider)).toBe(1);
    expect(post.mock.calls.map(([, { body }]) => body.content)).toEqual(['Video v9']);
  });
});
