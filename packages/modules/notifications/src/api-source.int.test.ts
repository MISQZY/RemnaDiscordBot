import { SecretBox, VipAccess, type CoreServices, type GuildEntities, type ModuleServices } from '@bot/core';
import { createLogger } from '@bot/logger';
import { createTestDatabase, type TestDatabase } from '@bot/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiSettings, sealSettings, storedSettings, storedSettingsDto } from './api-settings.js';
import { ApiProvider } from './api-source.js';
import type { NotificationsConfig } from './config.js';
import { pollProvider } from './poll.js';
import { resealSecrets } from './reseal.js';
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
    // The address and the key are sealed in the database, the rest is as it was.
    const stored = (await database.db.notificationSource.findFirstOrThrow()).settings as { url: string; headers: { name: string; value: string }[]; idField: string };
    expect(stored.url).toMatch(/^sb1\./);
    expect(stored.headers[0]).toEqual({ name: 'Authorization', value: expect.stringMatching(/^sb1\./) });
    expect(stored.idField).toBe('id');
    expect(JSON.stringify(stored)).not.toContain('secret');
    expect(storedSettings(stored)?.headers[0]?.value).toBe('Bearer secret');
  });

  it('shows settings no key opens without the address, and reads ones saved before sealing', async () => {
    const sealed = sealSettings(ApiSettings.parse({ url: 'https://api.example/x', headers: [{ name: 'Authorization', value: 'k' }] }));
    const foreign = { ...sealed, url: new SecretBox(['another-key']).seal('https://api.example/x') };
    expect(storedSettings(foreign)).toBeNull();
    expect(storedSettingsDto(foreign)).toEqual({ url: '', headers: [{ name: 'Authorization' }], itemsPath: '', idField: 'id', oldestFirst: false });
    expect(storedSettings({ url: 'https://api.example/plain', headers: [{ name: 'X-Key', value: 'plain' }] })?.headers[0]?.value).toBe('plain');
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
    expect(storedSettings(source.settings)?.headers).toEqual([{ name: 'Authorization', value: 'Bearer secret' }]);
    expect(source.seenIds).toBeNull();
    expect(fetchText).toHaveBeenLastCalledWith('https://api.example/other', expect.objectContaining({ Authorization: 'Bearer secret' }));
  });

  it('reseals with the current key what an older key or none sealed', async () => {
    const tokenKey = new SecretBox(['the-bot-token']);
    const legacy = await database.db.notificationSource.create({
      data: {
        provider: 'api',
        externalId: 'legacy',
        name: 'Legacy',
        settings: { url: tokenKey.seal('https://api.example/legacy'), headers: [{ name: 'X-Key', value: 'plain-key' }], itemsPath: '', idField: 'id', oldestFirst: false },
      },
    });
    const hook = await database.db.notificationSubscription.create({
      data: { guildId: GUILD, sourceId: legacy.id, channelId: CHANNEL, message: {}, webhookToken: tokenKey.seal('hook-token') },
    });
    // The box of a process with SECRETS_KEY set and the bot token after it.
    const box = SecretBox.fromEnv({ SECRETS_KEY: process.env.SECRETS_KEY, DISCORD_TOKEN: 'the-bot-token' });
    // The other sources are already sealed with SECRETS_KEY: only these two move.
    expect(await resealSecrets(ctx, box)).toBe(2);
    expect(await resealSecrets(ctx, box)).toBe(0);

    const current = new SecretBox([process.env.SECRETS_KEY!]);
    const source = await database.db.notificationSource.findUniqueOrThrow({ where: { id: legacy.id } });
    const settings = source.settings as { url: string; headers: { value: string }[] };
    expect(current.open(settings.url)).toBe('https://api.example/legacy');
    expect(current.open(settings.headers[0]!.value)).toBe('plain-key');
    expect(storedSettings(source.settings)?.url).toBe('https://api.example/legacy');
    const token = (await database.db.notificationSubscription.findUniqueOrThrow({ where: { id: hook.id } })).webhookToken!;
    expect(current.open(token)).toBe('hook-token');
  });
});
