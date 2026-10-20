import { MessageTemplate, Snowflake } from '@bot/contracts';
import { z } from 'zod';

const ChannelMessage = z.object({
  enabled: z.boolean(),
  channelId: Snowflake.nullable(),
  message: MessageTemplate,
});

export const WelcomeConfig = z.object({
  join: ChannelMessage,
  joinDm: z.object({ enabled: z.boolean(), message: MessageTemplate }),
  leave: ChannelMessage,
  ignoreBots: z.boolean(),
  /** With Membership Screening, greet members once they accept the rules rather than on join. */
  waitForScreening: z.boolean().default(false),
});
export type WelcomeConfig = z.infer<typeof WelcomeConfig>;

export const defaultWelcomeConfig: WelcomeConfig = {
  join: {
    enabled: true,
    channelId: null,
    message: { content: 'Добро пожаловать на **{guild.name}**, {user.mention}! Ты наш {guild.memberCount}-й участник.' },
  },
  joinDm: {
    enabled: false,
    message: { content: 'Привет, {user.displayName}! Рады видеть тебя на **{guild.name}**.' },
  },
  leave: {
    enabled: false,
    channelId: null,
    message: { content: '**{user.name}** покинул сервер.' },
  },
  ignoreBots: true,
  waitForScreening: false,
};

export const WelcomeKind = z.enum(['join', 'leave', 'dm']);
export type WelcomeKind = z.infer<typeof WelcomeKind>;
