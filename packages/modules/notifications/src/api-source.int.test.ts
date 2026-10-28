import { VipAccess, type CoreServices, type GuildEntities, type ModuleServices } from '@bot/core';
import { createLogger } from '@bot/logger';
import { createTestDatabase, type TestDatabase } from '@bot/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from './api-source.js';
import type { NotificationsConfig } from './config.js';
import { pollProvider } from './poll.js';
import type { ProviderId, Provider } from './providers.js';
import type { FetchText } from './safe-fetch.js';
import { SubscriptionService } from './service.js';

const GUILD = '300000000000000003';
const OTHER = '300000000000000004';
const CHANNEL = '500000000000000005';
const entities = { channels: [{ id: CHANNEL, type: 0 }], roles: [] } as unknown as GuildEntities;

describe('API sources', () => {
  let database: TestDatabase;
  let answer: unknown[] = [{ id: 1, title: 'One' }];
  const fetchText = vi.fn<FetchText>(async (url) => ({ url, status: 200, headers: {}, body: JSON.stringify(answer) }));
  const provider = new ApiProvider(fetchText);
  const vip = new VipAccess();
  const post = vi.fn(async () => ({}));
  let service: SubscriptionService;
  let ctx: ModuleServices<NotificationsConfig>;

  beforeAll(async () => {
    database = await createTestDatabase();
    const config = { vip, isEnabled: async () => true };
    service = new SubscriptionService({ db: database.db, config } as unknown as Pick<CoreServices, 'db' | 'i18n' | 'guildLocales' | 'config'>, () => new Map<ProviderId, Provider>([['api', provider]]));
    ctx = {
      db: database.db,
      rest: { post },
      config,
      logger: createLogger({ service: 'test', level: 'silent', pretty: false }),
    } as unknown as ModuleServices<NotificationsConfig>;
  });

  afterAll(async () => {
    await database.cleanup();
  });

  const create = (guildId = GUILD) =>
    service.create(
      guildId,
      {
        provider: 'api',
        query: 'Releases',
        channelId: CHANNEL,
        mentionRoleId: null,
        message: { content: '{item.title}' },
        api: { url: 'https://api.example/items', headers: [{ name: 'Authorization', value: 'Bearer secret' }], itemsPath: '', idField: 'id', oldestFirst: false },
      },
      entities,
    );

  it('needs VIP where the dashboard says the feature needs it', async () => {
    vip.set({ modules: [], features: ['notificationsApi'], guilds: [{ guildId: GUILD, expiresAt: null }] });
    await expect(create(OTHER)).rejects.toMatchObject({ problem: 'vipRequired', statusCode: 403 });
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('checks the API, keeps the secret and shows the settings without it', async () => {
    const created = await create();

    expect(created).toMatchObject({ provider: 'api', source: { name: 'Releases' }, api: { url: 'https://api.example/items', headers: [{ name: 'Authorization' }] } });
    expect(JSON.stringify(created)).not.toContain('secret');
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect((await database.db.notificationSource.findFirstOrThrow()).settings).toMatchObject({ headers: [{ name: 'Authorization', value: 'Bearer secret' }] });
  });

  it('polls only for guilds with VIP and announces new items', async () => {
    expect(await pollProvider(ctx, provider)).toBe(0);
    answer = [{ id: 2, title: 'Two' }, { id: 1, title: 'One' }];
    expect(await pollProvider(ctx, provider)).toBe(1);
    expect(post).toHaveBeenCalledWith(`/channels/${CHANNEL}/messages`, { body: expect.objectContaining({ content: 'Two' }) });

    // VIP is gone: the source is not even requested.
    vip.set({ modules: [], features: ['notificationsApi'], guilds: [] });
    fetchText.mockClear();
    expect(await pollProvider(ctx, provider)).toBe(0);
    expect(fetchText).not.toHaveBeenCalled();
    vip.set({ modules: [], features: [], guilds: [] });
  });

  it('keeps a hidden header on change and forgets what was seen at a new address', async () => {
    const [subscription] = await service.list(GUILD);
    const updated = await service.update(
      GUILD,
      subscription!.id,
      { api: { url: 'https://api.example/other', headers: [{ name: 'Authorization', value: null }], itemsPath: '', idField: 'id', oldestFirst: false } },
      entities,
    );

    expect(updated.api?.url).toBe('https://api.example/other');
    const source = await database.db.notificationSource.findFirstOrThrow();
    expect(source.settings).toMatchObject({ headers: [{ name: 'Authorization', value: 'Bearer secret' }] });
    expect(source.seenIds).toBeNull();
    expect(fetchText).toHaveBeenLastCalledWith('https://api.example/other', expect.objectContaining({ Authorization: 'Bearer secret' }));
  });
});
