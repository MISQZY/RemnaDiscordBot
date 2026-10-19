import type { ModuleServices } from '@bot/core';
import { createLogger } from '@bot/logger';
import { createTestDatabase, type TestDatabase } from '@bot/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NotificationsConfig } from './config.js';
import { pollProvider } from './poll.js';
import type { FeedItem, Provider } from './providers.js';

const video = (id: string): FeedItem => ({ id, vars: { 'video.title': `Video ${id}`, 'video.url': `https://yt/${id}`, 'channel.name': 'Chan' } });

describe('pollProvider', () => {
  let database: TestDatabase;
  let feed: FeedItem[] = [];
  const provider: Provider = {
    id: 'youtube',
    lookup: vi.fn(),
    latest: async (ids) => new Map(ids.map((id) => [id, feed])),
  };
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
      logger: createLogger({ service: 'test', level: 'silent', pretty: false }),
      // Модуль включён во всех гильдиях, кроме третьей.
      config: { isEnabled: async (guildId: string) => guildId !== '3' },
    } as unknown as ModuleServices<NotificationsConfig>;
  });

  afterAll(async () => {
    await database.cleanup();
  });

  it('only remembers the newest item on the first check', async () => {
    feed = [video('v2'), video('v1')];

    expect(await pollProvider(ctx, provider)).toBe(0);
    expect((await database.db.notificationSource.findFirstOrThrow()).lastItemId).toBe('v2');
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
});
