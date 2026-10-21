import { Snowflake } from '@bot/contracts';
import { z } from 'zod';
import { regexProblem } from './patterns.js';

/** What happens to a message that broke a filter and to its author. */
export const FilterAction = z.object({
  delete: z.boolean(),
  /** Goes through the moderation module: a case, its DM, escalation of warnings. */
  punishment: z.enum(['none', 'warn', 'mute', 'kick', 'ban']),
  /** Mute length (Discord's timeout). */
  muteSec: z.number().int().min(60).max(28 * 86_400),
});
export type FilterAction = z.infer<typeof FilterAction>;

const base = {
  enabled: z.boolean(),
  action: FilterAction,
  exemptRoleIds: z.array(Snowflake).max(25),
  exemptChannelIds: z.array(Snowflake).max(50),
};

/** A bare domain: `example.com`, `sub.example.org`. Subdomains match too. */
export const Domain = z
  .string()
  .max(253)
  .transform((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
  .pipe(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$/, 'Not a domain'));

const Pattern = z
  .string()
  .min(1)
  .max(200)
  .superRefine((pattern, ctx) => {
    const problem = regexProblem(pattern);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const AutomodConfig = z.object({
  /** Where the bot reports what the filters did; `null` — no log. */
  logChannelId: Snowflake.nullable(),
  /** A short notice in the channel after a message is deleted, removed after a few seconds. */
  notifyInChannel: z.boolean(),
  /** Never checked by any filter (moderators with Manage Messages are skipped anyway). */
  exemptRoleIds: z.array(Snowflake).max(25),
  exemptChannelIds: z.array(Snowflake).max(50),
  filters: z.object({
    invites: z.object({ ...base, allowOwnServer: z.boolean() }),
    links: z.object({
      ...base,
      /** `all` — any link except the allowed domains; `blocklist` — only the blocked domains. */
      mode: z.enum(['all', 'blocklist']),
      allowedDomains: z.array(Domain).max(100),
      blockedDomains: z.array(Domain).max(200),
    }),
    caps: z.object({ ...base, percent: z.number().int().min(50).max(100), minLength: z.number().int().min(5).max(200) }),
    mentions: z.object({ ...base, max: z.number().int().min(2).max(50) }),
    spam: z.object({ ...base, messages: z.number().int().min(3).max(30), seconds: z.number().int().min(2).max(60) }),
    duplicates: z.object({ ...base, count: z.number().int().min(2).max(10), seconds: z.number().int().min(5).max(600) }),
    words: z.object({
      ...base,
      /** Whole words, case-insensitive; `*` stands for any letters (`spam*`). */
      words: z.array(z.string().trim().min(1).max(100)).max(500),
      patterns: z.array(Pattern).max(25),
    }),
    emojis: z.object({ ...base, max: z.number().int().min(3).max(100) }),
  }),
  raid: z.object({
    enabled: z.boolean(),
    /** This many joins within `seconds` starts raid mode. */
    joins: z.number().int().min(3).max(100),
    seconds: z.number().int().min(5).max(300),
    /** Raid mode length; it can be ended earlier with /automod raid-end. */
    durationMin: z.number().int().min(5).max(1440),
    lockdown: z.boolean(),
    /** Discord's own pause of invites (at most a day). */
    pauseInvites: z.boolean(),
    /** What happens to those who join during raid mode. */
    joinAction: z.enum(['none', 'timeout', 'kick', 'ban']),
    alertChannelId: Snowflake.nullable(),
    alertRoleId: Snowflake.nullable(),
  }),
  accountAge: z.object({
    enabled: z.boolean(),
    minDays: z.number().int().min(1).max(365),
    action: z.enum(['timeout', 'kick', 'ban']),
  }),
});
export type AutomodConfig = z.infer<typeof AutomodConfig>;

export const FILTERS = ['invites', 'links', 'caps', 'mentions', 'spam', 'duplicates', 'words', 'emojis'] as const;
export type FilterName = (typeof FILTERS)[number];

const action = (punishment: FilterAction['punishment'] = 'none'): FilterAction => ({ delete: true, punishment, muteSec: 600 });
const off = { enabled: false, exemptRoleIds: [], exemptChannelIds: [] };

export const defaultAutomodConfig: AutomodConfig = {
  logChannelId: null,
  notifyInChannel: true,
  exemptRoleIds: [],
  exemptChannelIds: [],
  filters: {
    invites: { ...off, action: action('warn'), allowOwnServer: true },
    links: { ...off, action: action(), mode: 'blocklist', allowedDomains: [], blockedDomains: [] },
    caps: { ...off, action: action(), percent: 70, minLength: 15 },
    mentions: { ...off, action: action('mute'), max: 5 },
    spam: { ...off, action: action('mute'), messages: 6, seconds: 5 },
    duplicates: { ...off, action: action(), count: 3, seconds: 60 },
    words: { ...off, action: action('warn'), words: [], patterns: [] },
    emojis: { ...off, action: action(), max: 15 },
  },
  raid: {
    enabled: false,
    joins: 10,
    seconds: 30,
    durationMin: 30,
    lockdown: true,
    pauseInvites: true,
    joinAction: 'none',
    alertChannelId: null,
    alertRoleId: null,
  },
  accountAge: { enabled: false, minDays: 3, action: 'kick' },
};
