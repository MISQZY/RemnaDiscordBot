import { createLogger } from '@bot/logger';
import type { APIEmbed, Guild } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogBatcher, embedLength } from './batcher.js';

describe('AuditLogBatcher', () => {
  const logger = createLogger({ service: 'test', level: 'silent', pretty: false });
  const sendMock = vi.fn(async () => {});
  const sendableChannel = { isSendable: () => true, send: sendMock };
  const guild = {
    id: 'guild-1',
    channels: {
      cache: new Map([['channel-1', sendableChannel]]),
      fetch: vi.fn(async () => sendableChannel),
    },
  } as unknown as Guild;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createEmbed = (title: string, desc = ''): APIEmbed => ({
    title,
    description: desc,
  });

  it('measures embed character length correctly', () => {
    const embed: APIEmbed = {
      title: 'Hello',
      description: 'World',
      author: { name: 'Author' },
      footer: { text: 'Footer' },
      fields: [{ name: 'f1', value: 'v1' }],
    };
    // 5 + 5 + 6 + 6 + (2 + 2) = 26
    expect(embedLength(embed)).toBe(26);
  });

  it('sends single embed after delay', async () => {
    const batcher = new AuditLogBatcher({ waitMs: 5 });
    await batcher.enqueue({
      guild,
      channelId: 'channel-1',
      category: 'messages',
      embed: createEmbed('Test 1'),
      logger,
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const [payload] = sendMock.mock.calls[0] as [{ embeds: APIEmbed[] }];
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0]!.title).toBe('Test 1');
  });

  it('groups multiple embeds within debounce window into a single message', async () => {
    const batcher = new AuditLogBatcher({ waitMs: 20 });
    const p1 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'messages', embed: createEmbed('E1'), logger });
    const p2 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'members', embed: createEmbed('E2'), logger });
    const p3 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'server', embed: createEmbed('E3'), logger });

    await Promise.all([p1, p2, p3]);

    expect(sendMock).toHaveBeenCalledOnce();
    const [payload] = sendMock.mock.calls[0] as [{ embeds: APIEmbed[] }];
    expect(payload.embeds).toHaveLength(3);
    expect(payload.embeds.map((e) => e.title)).toEqual(['E1', 'E2', 'E3']);
  });

  it('flushes immediately when reaching maxBatchSize (10 embeds)', async () => {
    const batcher = new AuditLogBatcher({ waitMs: 1000, maxBatchSize: 10 });
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        batcher.enqueue({ guild, channelId: 'channel-1', category: 'messages', embed: createEmbed(`E${i + 1}`), logger }),
      );
    }

    await Promise.all(promises);

    expect(sendMock).toHaveBeenCalledOnce();
    const [payload] = sendMock.mock.calls[0] as [{ embeds: APIEmbed[] }];
    expect(payload.embeds).toHaveLength(10);
  });

  it('splits into multiple messages when exceeding maxChars', async () => {
    // maxChars = 100
    const batcher = new AuditLogBatcher({ waitMs: 5, maxChars: 100 });
    // Each embed has ~60 chars
    const p1 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'messages', embed: createEmbed('A'.repeat(60)), logger });
    const p2 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'messages', embed: createEmbed('B'.repeat(60)), logger });

    await Promise.all([p1, p2]);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const [call1] = sendMock.mock.calls[0] as [{ embeds: APIEmbed[] }];
    const [call2] = sendMock.mock.calls[1] as [{ embeds: APIEmbed[] }];
    expect(call1.embeds).toHaveLength(1);
    expect(call2.embeds).toHaveLength(1);
  });

  it('enforces queue limit and drops overflowing events with warning', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const batcher = new AuditLogBatcher({ waitMs: 100, maxQueue: 3 });

    const p1 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'messages', embed: createEmbed('1'), logger });
    const p2 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'messages', embed: createEmbed('2'), logger });
    const p3 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'messages', embed: createEmbed('3'), logger });
    const p4 = batcher.enqueue({ guild, channelId: 'channel-1', category: 'messages', embed: createEmbed('4'), logger });

    await Promise.all([p1, p2, p3, p4]);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'channel-1' }),
      'Audit log queue full, dropping event',
    );

    const [call] = sendMock.mock.calls[0] as [{ embeds: APIEmbed[] }];
    expect(call.embeds).toHaveLength(3);
    expect(call.embeds.map((e) => e.title)).toEqual(['1', '2', '3']);
  });

  it('handles non-sendable channel gracefully', async () => {
    const unsendable = { isSendable: () => false };
    const guildUnsendable = {
      id: 'guild-2',
      channels: {
        cache: new Map([['channel-broken', unsendable]]),
        fetch: vi.fn(),
      },
    } as unknown as Guild;

    const warnSpy = vi.spyOn(logger, 'warn');
    const batcher = new AuditLogBatcher({ waitMs: 5 });

    await batcher.enqueue({
      guild: guildUnsendable,
      channelId: 'channel-broken',
      category: 'messages',
      embed: createEmbed('Broken'),
      logger,
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'channel-broken' }),
      'Audit log channel is missing or not writable',
    );
  });
});
