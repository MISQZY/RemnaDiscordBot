import { Snowflake } from '@bot/contracts';
import type { ModCase } from '@bot/db';
import { z } from 'zod';
import { MAX_TIMEOUT_SEC } from './duration.js';

export const EscalationRule = z.object({
  /** Number of active warnings that triggers the rule. */
  warns: z.number().int().min(1).max(50),
  action: z.enum(['mute', 'kick', 'ban']),
  /** Required for mutes (≤ 28 days); for bans it makes the ban temporary. */
  durationSec: z.number().int().min(60).max(365 * 86_400).nullable(),
});

export const ModerationConfig = z
  .object({
    /** Case log channel. */
    logChannelId: Snowflake.nullable(),
    /** DM the offender about the punishment. */
    dmOnAction: z.boolean(),
    requireReason: z.boolean(),
    /** After how many days a warning stops counting; 0 — never. */
    warnExpiryDays: z.number().int().min(0).max(365),
    escalation: z.array(EscalationRule).max(10),
    /** Shown in the punishment DM: where to appeal. */
    appealUrl: z.url({ protocol: /^https?$/ }).max(500).nullable().default(null),
    /** Extra text of the punishment DM (rules, contacts). */
    dmNote: z.string().max(500).default(''),
    /** Record cases of bans, kicks and timeouts done in Discord itself (needs View Audit Log). */
    trackNativeActions: z.boolean().default(true),
    /** Where reports from the message menu go; `null` — reports are off. */
    reportChannelId: Snowflake.nullable().default(null),
    /** Pinged with each report. */
    reportRoleId: Snowflake.nullable().default(null),
    lockdown: z
      .object({
        /** Channels a server lockdown closes; empty — every channel everyone can see. */
        channelIds: z.array(Snowflake).max(100),
        /** Post a notice in each channel on lock and unlock. */
        announce: z.boolean(),
      })
      .default({ channelIds: [], announce: true }),
    /**
     * A channel nobody should write in: whoever does (bots and moderators aside) is taken for a spam bot.
     * `softban` — banned to delete their messages and unbanned at once: they can come back.
     */
    honeypot: z
      .object({
        channelId: Snowflake.nullable(),
        action: z.enum(['ban', 'softban', 'kick', 'mute']),
        /** Ban and softban delete the member's messages of this many last hours (Discord allows up to 7 days). */
        deleteHours: z.number().int().min(0).max(168),
        muteSec: z.number().int().min(60).max(28 * 86_400),
      })
      .default({ channelId: null, action: 'softban', deleteHours: 24, muteSec: 86_400 }),
  })
  .refine((c) => new Set(c.escalation.map((r) => r.warns)).size === c.escalation.length, {
    message: 'Each warning count can have only one rule',
    path: ['escalation'],
  })
  .refine((c) => c.escalation.every((r) => r.action !== 'mute' || (r.durationSec !== null && r.durationSec <= MAX_TIMEOUT_SEC)), {
    message: 'Mute rules need a duration of at most 28 days',
    path: ['escalation'],
  });
export type ModerationConfig = z.infer<typeof ModerationConfig>;

export const defaultModerationConfig: ModerationConfig = {
  logChannelId: null,
  dmOnAction: true,
  requireReason: false,
  warnExpiryDays: 30,
  escalation: [
    { warns: 3, action: 'mute', durationSec: 3600 },
    { warns: 5, action: 'ban', durationSec: null },
  ],
  appealUrl: null,
  dmNote: '',
  trackNativeActions: true,
  reportChannelId: null,
  reportRoleId: null,
  lockdown: { channelIds: [], announce: true },
  honeypot: { channelId: null, action: 'softban', deleteHours: 24, muteSec: 86_400 },
};

/** `note` — a moderator's note about a member: no punishment, only history. */
export const CaseType = z.enum(['ban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'note']);
export type CaseType = z.infer<typeof CaseType>;

/** Moderator of automatic actions (escalation, expiry). */
export const SYSTEM_MODERATOR = 'system';

export const ModCaseDto = z.object({
  number: z.number().int(),
  type: CaseType,
  targetId: Snowflake,
  moderatorId: z.string(),
  reason: z.string().nullable(),
  durationSec: z.number().int().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  /** The punishment is in effect now: not revoked and not expired. */
  active: z.boolean(),
  revokedAt: z.iso.datetime().nullable(),
  revokedBy: z.string().nullable(),
  revokeReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ModCaseDto = z.infer<typeof ModCaseDto>;

const LASTING: CaseType[] = ['ban', 'mute', 'warn'];

export function isActive(modCase: Pick<ModCase, 'type' | 'revokedAt' | 'expiresAt'>, now = new Date()): boolean {
  if (modCase.revokedAt || !LASTING.includes(modCase.type as CaseType)) return false;
  return modCase.expiresAt === null || modCase.expiresAt > now;
}

export function toCaseDto(modCase: ModCase): ModCaseDto {
  return {
    number: modCase.number,
    type: modCase.type as CaseType,
    targetId: modCase.targetId,
    moderatorId: modCase.moderatorId,
    reason: modCase.reason,
    durationSec: modCase.durationSec,
    expiresAt: modCase.expiresAt?.toISOString() ?? null,
    active: isActive(modCase),
    revokedAt: modCase.revokedAt?.toISOString() ?? null,
    revokedBy: modCase.revokedBy,
    revokeReason: modCase.revokeReason,
    createdAt: modCase.createdAt.toISOString(),
  };
}
