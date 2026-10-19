import { MessageTemplate, Snowflake } from '@bot/contracts';
import type { MemberLevel } from '@bot/db';
import { z } from 'zod';
import { levelProgress } from './formula.js';

export const LevelingConfig = z
  .object({
    xpPerMessage: z.object({ min: z.number().int().min(1).max(100), max: z.number().int().min(1).max(100) }),
    /** Message XP is granted at most once per this interval. */
    cooldownSec: z.number().int().min(0).max(3600),
    ignoredChannelIds: z.array(Snowflake).max(100),
    ignoredRoleIds: z.array(Snowflake).max(50),
    /** XP multipliers: the highest role multiplier times the channel's multiplier. */
    multipliers: z.array(z.object({ type: z.enum(['role', 'channel']), id: Snowflake, value: z.number().min(0).max(10) })).max(25),
    announcement: z.object({
      /** `current` — to the message's channel, `channel` — to the chosen one, `dm` — via DM. */
      mode: z.enum(['off', 'current', 'channel', 'dm']),
      channelId: Snowflake.nullable(),
      message: MessageTemplate,
    }),
    rewards: z.array(z.object({ level: z.number().int().min(1).max(1000), roleId: Snowflake })).max(50),
    /** Keep roles for previous levels or only the highest one. */
    stackRewards: z.boolean(),
    publicLeaderboard: z.boolean(),
  })
  .refine((c) => c.xpPerMessage.min <= c.xpPerMessage.max, { message: 'min must not exceed max', path: ['xpPerMessage'] })
  .refine((c) => new Set(c.rewards.map((r) => r.level)).size === c.rewards.length, {
    message: 'Each level can have only one reward role',
    path: ['rewards'],
  });
export type LevelingConfig = z.infer<typeof LevelingConfig>;

export const defaultLevelingConfig: LevelingConfig = {
  xpPerMessage: { min: 15, max: 25 },
  cooldownSec: 60,
  ignoredChannelIds: [],
  ignoredRoleIds: [],
  multipliers: [],
  announcement: { mode: 'current', channelId: null, message: { content: '{user.mention} достиг уровня **{level}**! 🎉' } },
  rewards: [],
  stackRewards: true,
  publicLeaderboard: false,
};

export const LeaderboardEntry = z.object({
  rank: z.number().int(),
  userId: Snowflake,
  username: z.string().nullable(),
  avatar: z.string().nullable(),
  xp: z.number().int(),
  level: z.number().int(),
  /** XP within the current level and how much is needed for the next one. */
  progress: z.object({ current: z.number().int(), needed: z.number().int() }),
  messages: z.number().int(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export function toEntry(row: MemberLevel, rank: number): LeaderboardEntry {
  const { current, needed } = levelProgress(row.xp);
  return {
    rank,
    userId: row.userId,
    username: row.username,
    avatar: row.avatar,
    xp: row.xp,
    level: row.level,
    progress: { current, needed },
    messages: row.messages,
  };
}
