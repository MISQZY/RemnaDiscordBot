import { createTestRedis } from '@bot/testing';
import { AutoModerationActionType, AutoModerationRuleTriggerType, type APIAutoModerationRule } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { isExempt, isSpared } from './bot.js';
import { AutomodConfig, defaultAutomodConfig } from './config.js';
import { badLinks, bannedWord, capsPercent, emojiCount, inviteCodes, staticViolation } from './filters.js';
import { fromDiscord, NativeRuleInput, toDiscord } from './native.js';
import { regexProblem, wordsRegex } from './patterns.js';
import { countJoin } from './raid.js';

const filters = defaultAutomodConfig.filters;
const all = () => true;

describe('message filters', () => {
  it('finds invite codes and links, leaving invites to their own filter', () => {
    expect(inviteCodes('join https://discord.gg/abc and discord.com/invite/x-y')).toEqual(['abc', 'x-y']);
    const links = { ...filters.links, mode: 'all' as const, allowedDomains: ['youtube.com'] };
    expect(badLinks('see https://www.youtube.com/watch https://m.youtube.com https://evil.example/x', links)).toEqual(['evil.example']);
    expect(badLinks('https://discord.gg/abc', links)).toEqual([]);
    expect(badLinks('https://bad.example https://ok.example', { ...filters.links, blockedDomains: ['bad.example'] })).toEqual(['bad.example']);
  });

  it('counts capitals among letters, ignoring mentions and links', () => {
    expect(capsPercent('HELLO world')).toEqual({ percent: 50, letters: 10 });
    expect(capsPercent('<@123456> https://EXAMPLE.COM ok').letters).toBe(2);
    expect(capsPercent('12345 !!!')).toEqual({ percent: 0, letters: 0 });
  });

  it('counts unicode and custom emojis', () => {
    expect(emojiCount('hi 😀😀 <:pog:123> <a:dance:456>')).toBe(4);
  });

  it('matches banned words as whole words with wildcards', () => {
    const regex = wordsRegex(['spam*', 'бот'])!;
    expect(regex.test('this is SPAMMY')).toBe(true);
    expect(regex.test('работа')).toBe(false);
    expect(regex.test('это бот!')).toBe(true);
    expect(wordsRegex([' '])).toBeNull();
    expect(bannedWord('buy cheap pills', { ...filters.words, patterns: ['che+ap'] })).toBe('cheap');
  });

  it('refuses regexes prone to catastrophic backtracking', () => {
    expect(regexProblem('(a+)+$')).toMatch(/Nested/);
    expect(regexProblem('[')).toMatch(/Invalid/);
    expect(regexProblem('free\\s+nitro')).toBeNull();
  });

  it('reports the first stateless filter a message breaks', () => {
    const on = { ...filters, caps: { ...filters.caps, minLength: 5 }, mentions: { ...filters.mentions, max: 2 } };
    expect(staticViolation(on, { content: 'STOP SHOUTING', mentions: 0 }, all)).toEqual({ filter: 'caps', detail: '100%' });
    expect(staticViolation(on, { content: 'hey', mentions: 3 }, all)).toEqual({ filter: 'mentions', detail: '3' });
    expect(staticViolation(on, { content: 'STOP SHOUTING', mentions: 0 }, (name) => name !== 'caps')).toBeNull();
  });
});

describe('exemptions', () => {
  it('skips moderators and exempt roles or channels of the module and the filter', () => {
    const config = { exemptRoleIds: ['staff'], exemptChannelIds: [] };
    const scope = { exemptRoleIds: [], exemptChannelIds: ['memes'] };
    expect(isExempt(config, scope, { roleIds: [], channelIds: ['general'], moderator: true })).toBe(true);
    expect(isExempt(config, scope, { roleIds: ['staff'], channelIds: ['general'], moderator: false })).toBe(true);
    expect(isExempt(config, scope, { roleIds: [], channelIds: ['memes'], moderator: false })).toBe(true);
    expect(isExempt(config, scope, { roleIds: [], channelIds: ['general'], moderator: false })).toBe(false);
  });
});

describe('honeypot', () => {
  it('spares the owner and moderators', () => {
    const member = (id: string, moderator = false) => ({ id, guild: { ownerId: 'owner' }, permissions: { has: () => moderator } });
    expect(isSpared(member('owner'))).toBe(true);
    expect(isSpared(member('mod', true))).toBe(true);
    expect(isSpared(member('spammer'))).toBe(false);
  });

  it('is off in configs saved before it', () => {
    const { honeypot, ...old } = defaultAutomodConfig;
    expect(AutomodConfig.parse(old).honeypot).toEqual({ ...honeypot, channelId: null });
  });
});

describe('raid detection', () => {
  it('reports the joins of the window once they reach the limit', async () => {
    const redis = createTestRedis();
    const raid = { ...defaultAutomodConfig.raid, joins: 3, seconds: 10 };
    const now = 1_000_000;
    expect(await countJoin({ redis }, 'g', 'a', raid, now)).toBeNull();
    expect(await countJoin({ redis }, 'g', 'b', raid, now + 5000)).toBeNull();
    // `a` is out of the window by now.
    expect(await countJoin({ redis }, 'g', 'c', raid, now + 11_000)).toBeNull();
    expect((await countJoin({ redis }, 'g', 'd', raid, now + 12_000))?.sort()).toEqual(['b', 'c', 'd']);
  });
});

describe('config', () => {
  it('normalizes domains and refuses what is not one', () => {
    const parsed = AutomodConfig.parse({ ...defaultAutomodConfig, filters: { ...filters, links: { ...filters.links, allowedDomains: ['https://www.YouTube.com/watch'] } } });
    expect(parsed.filters.links.allowedDomains).toEqual(['youtube.com']);
    expect(AutomodConfig.safeParse({ ...defaultAutomodConfig, filters: { ...filters, links: { ...filters.links, blockedDomains: ['not a domain'] } } }).success).toBe(false);
  });
});

describe('native AutoMod rules', () => {
  const input: NativeRuleInput = {
    name: 'No scams',
    enabled: true,
    trigger: { type: 'keyword', keywords: ['free nitro'], regexPatterns: [], allowList: [] },
    block: true,
    blockMessage: 'No scams here',
    alertChannelId: '200000000000000002',
    timeoutSec: 600,
    exemptRoleIds: [],
    exemptChannelIds: [],
  };

  it('builds the Discord body and reads it back', () => {
    const body = toDiscord(input, { create: true });
    expect(body).toMatchObject({ trigger_type: AutoModerationRuleTriggerType.Keyword, trigger_metadata: { keyword_filter: ['free nitro'] } });
    expect(body.actions.map((a) => a.type)).toEqual([AutoModerationActionType.BlockMessage, AutoModerationActionType.SendAlertMessage, AutoModerationActionType.Timeout]);
    expect(toDiscord(input, { create: false })).not.toHaveProperty('trigger_type');

    const rule = { id: '1', guild_id: 'g', creator_id: '2', event_type: 1, trigger_type: body.trigger_type, trigger_metadata: body.trigger_metadata, actions: body.actions, enabled: true, name: input.name, exempt_roles: [], exempt_channels: [] };
    expect(fromDiscord(rule as unknown as APIAutoModerationRule)).toEqual({ ...input, id: '1', creatorId: '2' });
  });

  it('refuses timeouts where Discord does not allow them and rules without actions', () => {
    expect(NativeRuleInput.safeParse({ ...input, trigger: { type: 'spam' } }).success).toBe(false);
    expect(NativeRuleInput.safeParse({ ...input, block: false, alertChannelId: null, timeoutSec: null }).success).toBe(false);
  });
});
