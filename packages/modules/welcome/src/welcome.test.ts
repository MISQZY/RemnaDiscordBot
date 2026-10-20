import type { BotModuleContext } from '@bot/core';
import { createLogger } from '@bot/logger';
import type { GuildMember, REST } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { sendTestMessage } from './api.js';
import { defaultWelcomeConfig, type WelcomeConfig } from './config.js';
import { greet } from './greet.js';
import welcome from './index.js';

const logger = createLogger({ service: 'test', level: 'silent', pretty: false });
const CHANNEL = '500000000000000005';

function fakeMember({ bot = false, dmFails = false } = {}) {
  const channel = { isSendable: () => true, send: vi.fn(async () => {}) };
  const member = {
    id: '1',
    nickname: null,
    joinedAt: new Date('2026-10-19T00:00:00Z'),
    user: {
      id: '1',
      username: 'neo',
      globalName: 'Neo',
      bot,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      displayAvatarURL: () => 'https://cdn.test/avatar.png',
    },
    guild: {
      id: '2',
      name: 'Zion',
      memberCount: 42,
      iconURL: () => null,
      channels: { cache: new Map([[CHANNEL, channel]]), fetch: vi.fn(async () => null) },
      members: { me: null },
      client: { user: { id: '3', displayName: 'Bot', displayAvatarURL: () => 'https://cdn.test/bot.png' } },
    },
    send: vi.fn(async () => {
      if (dmFails) throw new Error('Cannot send messages to this user');
    }),
  };
  return { member: member as unknown as GuildMember, channel, send: member.send };
}

const config = (patch: Partial<WelcomeConfig> = {}): WelcomeConfig => ({
  ...defaultWelcomeConfig,
  join: { ...defaultWelcomeConfig.join, channelId: CHANNEL },
  ...patch,
});

describe('greet', () => {
  it('sends the rendered join message to the configured channel', async () => {
    const { member, channel } = fakeMember();

    expect(await greet('join', member, config(), logger)).toBe(true);
    expect(channel.send).toHaveBeenCalledWith({
      content: 'Добро пожаловать на **Zion**, <@1>! Ты наш 42-й участник.',
      allowedMentions: { parse: ['users'] },
    });
  });

  it('skips disabled messages unless forced', async () => {
    const { member, channel } = fakeMember();
    const leave = { ...defaultWelcomeConfig.leave, channelId: CHANNEL };

    expect(await greet('leave', member, config({ leave }), logger)).toBe(false);
    expect(await greet('leave', member, config({ leave }), logger, { force: true })).toBe(true);
    expect(channel.send).toHaveBeenCalledOnce();
  });

  it('treats closed DMs as not delivered', async () => {
    const { member } = fakeMember({ dmFails: true });
    const joinDm = { ...defaultWelcomeConfig.joinDm, enabled: true };

    expect(await greet('dm', member, config({ joinDm }), logger)).toBe(false);
  });
});

describe('welcome module', () => {
  const ctx = (cfg: WelcomeConfig) => ({ logger, getConfig: async () => cfg }) as unknown as BotModuleContext<WelcomeConfig>;

  it('greets new members but ignores bots by default', async () => {
    const human = fakeMember();
    const bot = fakeMember({ bot: true });

    await welcome.bot!.events!.guildMemberAdd!(ctx(config()), human.member);
    await welcome.bot!.events!.guildMemberAdd!(ctx(config()), bot.member);

    expect(human.channel.send).toHaveBeenCalledOnce();
    expect(bot.channel.send).not.toHaveBeenCalled();
  });

  it('validates configured channels', () => {
    const issues = welcome.validateConfig!(config(), { channels: [], roles: [] });
    expect(issues).toEqual([{ path: ['join', 'channelId'], message: `Channel ${CHANNEL} not found` }]);
  });
});

describe('sendTestMessage', () => {
  it('renders with the requesting member and posts via REST', async () => {
    const posts: { route: string; body: unknown }[] = [];
    const rest = {
      get: vi.fn(async (route: string) =>
        route.includes('/members/')
          ? { user: { id: '7', username: 'trinity', global_name: 'Trinity' }, nick: null, joined_at: null }
          : { id: '2', name: 'Zion', approximate_member_count: 99 },
      ),
      post: vi.fn(async (route: string, { body }: { body: unknown }) => {
        posts.push({ route, body });
        return { id: 'dm-channel' };
      }),
    } as unknown as REST;

    expect(await sendTestMessage(rest, config(), { guildId: '2', userId: '7', kind: 'join' })).toEqual({ sent: true });
    expect(posts).toEqual([
      {
        route: `/channels/${CHANNEL}/messages`,
        body: { content: 'Добро пожаловать на **Zion**, <@7>! Ты наш 99-й участник.', allowed_mentions: { parse: ['users'] } },
      },
    ]);
  });

  it('reports a missing channel without calling Discord', async () => {
    const rest = { get: vi.fn(), post: vi.fn() } as unknown as REST;
    expect(await sendTestMessage(rest, defaultWelcomeConfig, { guildId: '2', userId: '7', kind: 'join' })).toEqual({
      sent: false,
      reason: 'Channel is not configured',
    });
  });
});
