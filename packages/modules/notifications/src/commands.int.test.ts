import { HttpError, type InteractionContext } from '@bot/core';
import { I18n } from '@bot/i18n';
import { createTestDatabase, type TestDatabase } from '@bot/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { notifyCommand } from './commands.js';
import type { NotificationsConfig } from './config.js';
import notifications from './index.js';
import type { Provider, ProviderId } from './providers.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000002';

describe('/notify', () => {
  let database: TestDatabase;
  let ctx: InteractionContext<NotificationsConfig>;
  const provider: Provider = {
    id: 'youtube',
    lookup: vi.fn(async (query: string) => {
      if (query === 'missing') throw HttpError.badRequest('YouTube channel not found');
      return { externalId: 'UC1', name: 'Chan', url: 'https://youtube.com/@chan' };
    }),
    latest: vi.fn(),
  };
  const command = notifyCommand(() => new Map<ProviderId, Provider>([['youtube', provider]]));

  const channel = { id: CHANNEL, name: 'news', type: 0, parentId: null, position: 0 };
  const guild = {
    id: GUILD,
    channels: { cache: new Map([[CHANNEL, channel]]) },
    roles: { cache: new Map() },
    members: { me: {} },
  };
  const textChannel = { ...channel, guild, permissionsFor: () => ({ has: () => true }) };

  beforeAll(async () => {
    database = await createTestDatabase();
    const i18n = new I18n('ru');
    i18n.register(notifications.id, notifications.locales!);
    ctx = {
      db: database.db,
      i18n,
      guildLocales: { get: async () => 'ru' },
      t: (key: string) => key,
    } as unknown as InteractionContext<NotificationsConfig>;
  });

  afterAll(async () => {
    await database.cleanup();
  });

  const interaction = (sub: string, strings: Record<string, string>, booleans: Record<string, boolean> = {}) => ({
    guild,
    guildId: GUILD,
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => strings[name] ?? null,
      getBoolean: (name: string) => booleans[name] ?? null,
      getChannel: () => (sub === 'add' ? textChannel : null),
      getRole: () => null,
    },
    reply: vi.fn(async () => {}),
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
  });

  it('subscribes with the default text in the server language', async () => {
    const add = interaction('add', { platform: 'youtube', source: '@chan' });
    await command.execute(add as never, ctx);

    expect(add.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'notifications.manage.added' }));
    const row = await database.db.notificationSubscription.findFirstOrThrow({ where: { guildId: GUILD } });
    expect(row).toMatchObject({ channelId: CHANNEL, enabled: true });
    expect((row.message as { content: string }).content).toContain('выпустил новое видео');
  });

  it('explains duplicates and unknown sources', async () => {
    const again = interaction('add', { platform: 'youtube', source: '@chan' });
    await command.execute(again as never, ctx);
    expect(again.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'notifications.manage.errors.conflict' }));

    const missing = interaction('add', { platform: 'youtube', source: 'missing' });
    await command.execute(missing as never, ctx);
    expect(missing.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'notifications.manage.errors.sourceNotFound' }));
  });

  it('pauses and removes a subscription', async () => {
    const { id } = await database.db.notificationSubscription.findFirstOrThrow({ where: { guildId: GUILD } });
    await command.execute(interaction('edit', { subscription: id }, { enabled: false }) as never, ctx);
    expect((await database.db.notificationSubscription.findUniqueOrThrow({ where: { id } })).enabled).toBe(false);

    await command.execute(interaction('remove', { subscription: id }) as never, ctx);
    expect(await database.db.notificationSubscription.count()).toBe(0);
    // The source has no subscribers left and is no longer polled.
    expect(await database.db.notificationSource.count()).toBe(0);
  });
});
