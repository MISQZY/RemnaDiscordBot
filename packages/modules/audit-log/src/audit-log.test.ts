import type { BotModuleContext } from '@bot/core';
import { I18n } from '@bot/i18n';
import { createLogger } from '@bot/logger';
import { createTestRedis } from '@bot/testing';
import { describe, expect, it, vi } from 'vitest';
import { defaultAuditLogConfig, type AuditLogConfig } from './config.js';
import { caseCreated, entityUpdated, memberUpdated, messageDeleted, serverChanged, voiceChanged } from './embeds.js';
import { onCaseCreated, overwriteChanges } from './handlers.js';
import auditLog from './index.js';

const i18n = new I18n('ru');
i18n.register(auditLog.id, auditLog.locales!);
const t = (key: string, vars?: Record<string, string | number>) => i18n.t('ru', key, vars);

const GUILD = '100000000000000001';
const LOG_CHANNEL = '200000000000000002';
const TEXT_CHANNEL = '300000000000000003';

describe('embeds', () => {
  it('shows deleted message content or explains it was not cached', () => {
    const withText = messageDeleted(t, { authorId: '1', channelId: '2', content: 'привет', attachments: [], createdAt: null });
    expect(withText.fields?.find((f) => f.name === 'Текст')?.value).toBe('привет');

    const unknown = messageDeleted(t, { authorId: null, channelId: '2', content: null, attachments: [], createdAt: null });
    expect(unknown.fields?.[0]?.value).toBe('неизвестно');
    expect(unknown.fields?.at(-1)?.value).toContain('текст недоступен');
  });

  it('describes changed channel overwrites per role and member', () => {
    const perms = (allow: bigint, deny: bigint, names: { allow: string[]; deny: string[] }) => ({
      allow: { bitfield: allow, toArray: () => names.allow },
      deny: { bitfield: deny, toArray: () => names.deny },
    });
    const before = { cache: new Map([[GUILD, { id: GUILD, type: 0, ...perms(0n, 0n, { allow: [], deny: [] }) }]]) };
    const after = {
      cache: new Map([
        [GUILD, { id: GUILD, type: 0, ...perms(0n, 2048n, { allow: [], deny: ['SendMessages'] }) }],
        ['5', { id: '5', type: 1, ...perms(1024n, 0n, { allow: ['ViewChannel'], deny: [] }) }],
      ]),
    };
    expect(overwriteChanges(before, after, GUILD)).toEqual([
      { field: 'overwrite', before: '@everyone: —', after: '-SendMessages' },
      { field: 'overwrite', before: '<@5>: —', after: '+ViewChannel' },
    ]);
    expect(overwriteChanges(after, after, GUILD)).toEqual([]);
  });

  it('names threads with their channel and author', () => {
    const embed = serverChanged(t, { kind: 'threadCreated', name: 'help', id: '9', parentId: TEXT_CHANNEL, authorId: '1' });
    expect(embed.title).toBe('Создана ветка');
    expect(embed.fields?.map((f) => f.value)).toEqual([`<#${TEXT_CHANNEL}>`, '<@1> (`1`)']);
  });

  it('skips member updates without visible changes', () => {
    expect(memberUpdated(t, { userId: '1', rolesAdded: [], rolesRemoved: [] })).toBeNull();
    expect(memberUpdated(t, { userId: '1', rolesAdded: ['5'], rolesRemoved: [] })?.fields).toEqual([{ name: 'Выданы роли', value: '<@&5>' }]);
  });

  it('lists changed channel and role properties', () => {
    expect(entityUpdated(t, { kind: 'role', id: '5', name: 'Mods', changes: [] })).toBeNull();
    const embed = entityUpdated(t, { kind: 'channel', id: '2', name: 'general', changes: [{ field: 'name', before: 'chat', after: 'general' }] });
    expect(embed?.title).toBe('Канал изменён');
    expect(embed?.fields).toEqual([{ name: 'Название', value: 'chat → general' }]);
  });

  it('describes moderation cases with their moderator', () => {
    const embed = caseCreated(t, { number: 7, type: 'warn', targetId: '1', moderatorId: '2', reason: null, expiresAt: null });
    expect(embed.title).toBe('Кейс #7 · Предупреждение');
    expect(embed.fields?.map((f) => f.value)).toEqual(['<@1> (`1`)', '<@2> (`2`)', 'не указана']);
    expect(caseCreated(t, { number: 8, type: 'mute', targetId: '1', moderatorId: 'system', reason: 'x', expiresAt: null }).fields?.[1]?.value).toBe(
      'Автоматически',
    );
  });

  it('describes voice joins, leaves and moves', () => {
    expect(voiceChanged(t, { userId: '1', from: null, to: '9' })?.title).toBe('Вошёл в голосовой канал');
    expect(voiceChanged(t, { userId: '1', from: '9', to: '8' })?.title).toBe('Перешёл в другой голосовой канал');
    expect(voiceChanged(t, { userId: '1', from: '9', to: '9' })).toBeNull();
  });
});

describe('message logging', () => {
  function setup(config: Partial<AuditLogConfig> = {}) {
    const logChannel = { isSendable: () => true, send: vi.fn(async () => {}) };
    const guild = { id: GUILD, channels: { cache: new Map([[LOG_CHANNEL, logChannel]]), fetch: vi.fn() } };
    const fullConfig = { ...defaultAuditLogConfig, channels: { ...defaultAuditLogConfig.channels, messages: LOG_CHANNEL }, ...config };
    const ctx = {
      logger: createLogger({ service: 'test', level: 'silent', pretty: false }),
      redis: createTestRedis(),
      i18n,
      guildLocales: { get: async () => 'ru' },
      getConfig: async () => fullConfig,
    } as unknown as BotModuleContext<AuditLogConfig>;
    const message = (patch: object = {}) =>
      ({
        id: '900000000000000009',
        guild,
        guildId: GUILD,
        channelId: TEXT_CHANNEL,
        author: { id: '400000000000000004', bot: false },
        member: null,
        content: 'первая версия',
        attachments: new Map(),
        createdTimestamp: Date.now(),
        url: 'https://discord.com/channels/1/2/3',
        inGuild: () => true,
        ...patch,
      }) as never;
    return { ctx, logChannel, message };
  }

  it('logs deleted messages with text from the cache', async () => {
    const { ctx, logChannel, message } = setup();
    await auditLog.bot!.events!.messageCreate!(ctx, message());

    // Discord sends deletions without the text.
    await auditLog.bot!.events!.messageDelete!(ctx, message({ content: null, author: null }));

    const [[payload]] = logChannel.send.mock.calls as unknown as [[{ embeds: { fields: { name: string; value: string }[] }[] }]];
    expect(payload.embeds[0]!.fields.find((f) => f.name === 'Текст')?.value).toBe('первая версия');
    expect(payload.embeds[0]!.fields.find((f) => f.name === 'Автор')?.value).toContain('400000000000000004');
  });

  it('logs edits once and ignores updates without text changes', async () => {
    const { ctx, logChannel, message } = setup();
    await auditLog.bot!.events!.messageCreate!(ctx, message());

    await auditLog.bot!.events!.messageUpdate!(ctx, message({ content: null }), message({ content: 'первая версия' }));
    await auditLog.bot!.events!.messageUpdate!(ctx, message({ content: null }), message({ content: 'вторая версия' }));

    expect(logChannel.send).toHaveBeenCalledOnce();
  });

  it('does not cache messages from ignored channels or bots', async () => {
    const { ctx, message } = setup({ ignoredChannelIds: [TEXT_CHANNEL] });
    await auditLog.bot!.events!.messageCreate!(ctx, message());
    await auditLog.bot!.events!.messageCreate!(ctx, message({ id: '900000000000000010', channelId: '1', author: { id: '1', bot: true } }));

    expect(await ctx.redis.keys('audit:msg:*')).toEqual([]);
  });
});

describe('moderation cases', () => {
  function setup(enabled = true) {
    const logChannel = { isSendable: () => true, send: vi.fn(async () => {}) };
    const guild = { id: GUILD, channels: { cache: new Map([[LOG_CHANNEL, logChannel]]), fetch: vi.fn() } };
    const config = { ...defaultAuditLogConfig, channels: { ...defaultAuditLogConfig.channels, moderation: LOG_CHANNEL } };
    const ctx = {
      moduleId: 'audit-log',
      i18n,
      guildLocales: { get: async () => 'ru' },
      getConfig: async () => config,
      config: { isEnabled: async () => enabled },
      client: { guilds: { cache: new Map([[GUILD, guild]]) } },
    } as unknown as BotModuleContext<AuditLogConfig>;
    return { ctx, logChannel };
  }
  const modCase = (type: string) =>
    ({ number: 1, type, targetId: '1', moderatorId: '2', reason: null, durationSec: null, expiresAt: null, active: true }) as never;

  it('logs cases of the bot commands but leaves bans to guildBanAdd', async () => {
    const { ctx, logChannel } = setup();
    await onCaseCreated(ctx, { guildId: GUILD, case: modCase('kick') });
    await onCaseCreated(ctx, { guildId: GUILD, case: modCase('ban') });
    expect(logChannel.send).toHaveBeenCalledOnce();
  });

  it('stays quiet when the module is disabled', async () => {
    const { ctx, logChannel } = setup(false);
    await onCaseCreated(ctx, { guildId: GUILD, case: modCase('warn') });
    expect(logChannel.send).not.toHaveBeenCalled();
  });
});
