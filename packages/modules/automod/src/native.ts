import { Snowflake } from '@bot/contracts';
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  type APIAutoModerationRule,
} from 'discord.js';
import { z } from 'zod';

// Discord's own AutoMod: rules Discord checks before a message is even posted. The dashboard edits them in a plainer
// shape than Discord's: a trigger and what to do, the rest is filled in here.

const PRESETS = { profanity: AutoModerationRuleKeywordPresetType.Profanity, sexual: AutoModerationRuleKeywordPresetType.SexualContent, slurs: AutoModerationRuleKeywordPresetType.Slurs } as const;
type Preset = keyof typeof PRESETS;

export const NativeTrigger = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('keyword'),
    keywords: z.array(z.string().min(1).max(60)).max(1000),
    /** Rust-flavoured regexes, checked by Discord. */
    regexPatterns: z.array(z.string().min(1).max(260)).max(10),
    allowList: z.array(z.string().min(1).max(60)).max(100),
  }),
  z.object({ type: z.literal('spam') }),
  z.object({
    type: z.literal('preset'),
    presets: z.array(z.enum(['profanity', 'sexual', 'slurs'])).min(1),
    allowList: z.array(z.string().min(1).max(60)).max(1000),
  }),
  z.object({
    type: z.literal('mentions'),
    limit: z.number().int().min(1).max(50),
    raidProtection: z.boolean(),
  }),
]);
export type NativeTrigger = z.infer<typeof NativeTrigger>;

export const NativeRuleInput = z
  .object({
    name: z.string().min(1).max(100),
    enabled: z.boolean(),
    trigger: NativeTrigger,
    /** Block the message; `blockMessage` is what its author sees instead. */
    block: z.boolean(),
    blockMessage: z.string().max(150).nullable(),
    alertChannelId: Snowflake.nullable(),
    /** Timeout of the author; Discord allows it for keywords and mentions only. */
    timeoutSec: z.number().int().min(60).max(28 * 86_400).nullable(),
    exemptRoleIds: z.array(Snowflake).max(20),
    exemptChannelIds: z.array(Snowflake).max(50),
  })
  .refine((r) => r.block || r.alertChannelId !== null || r.timeoutSec !== null, { message: 'A rule needs at least one action', path: ['block'] })
  .refine((r) => r.timeoutSec === null || r.trigger.type === 'keyword' || r.trigger.type === 'mentions', {
    message: 'Timeouts work only with keyword and mention rules',
    path: ['timeoutSec'],
  });
export type NativeRuleInput = z.infer<typeof NativeRuleInput>;

export const NativeRule = z.object({ id: Snowflake, creatorId: Snowflake }).and(NativeRuleInput);
export type NativeRule = z.infer<typeof NativeRule>;

const presetName = (value: AutoModerationRuleKeywordPresetType) => (Object.keys(PRESETS) as Preset[]).find((k) => PRESETS[k] === value);

/** Discord's rule in the dashboard's shape; `null` for kinds the dashboard does not edit (member profile rules). */
export function fromDiscord(rule: APIAutoModerationRule): NativeRule | null {
  const meta = rule.trigger_metadata;
  let trigger: NativeTrigger;
  switch (rule.trigger_type) {
    case AutoModerationRuleTriggerType.Keyword:
      trigger = { type: 'keyword', keywords: meta.keyword_filter ?? [], regexPatterns: meta.regex_patterns ?? [], allowList: meta.allow_list ?? [] };
      break;
    case AutoModerationRuleTriggerType.Spam:
      trigger = { type: 'spam' };
      break;
    case AutoModerationRuleTriggerType.KeywordPreset:
      trigger = { type: 'preset', presets: (meta.presets ?? []).map(presetName).filter((p): p is Preset => Boolean(p)), allowList: meta.allow_list ?? [] };
      break;
    case AutoModerationRuleTriggerType.MentionSpam:
      trigger = { type: 'mentions', limit: meta.mention_total_limit ?? 5, raidProtection: meta.mention_raid_protection_enabled ?? false };
      break;
    default:
      return null;
  }
  const block = rule.actions.find((a) => a.type === AutoModerationActionType.BlockMessage);
  const alert = rule.actions.find((a) => a.type === AutoModerationActionType.SendAlertMessage);
  const timeout = rule.actions.find((a) => a.type === AutoModerationActionType.Timeout);
  return {
    id: rule.id,
    creatorId: rule.creator_id,
    name: rule.name,
    enabled: rule.enabled,
    trigger,
    block: Boolean(block),
    blockMessage: block?.metadata?.custom_message ?? null,
    alertChannelId: alert?.metadata?.channel_id ?? null,
    timeoutSec: timeout?.metadata?.duration_seconds ?? null,
    exemptRoleIds: rule.exempt_roles,
    exemptChannelIds: rule.exempt_channels,
  };
}

const TRIGGER_TYPES = {
  keyword: AutoModerationRuleTriggerType.Keyword,
  spam: AutoModerationRuleTriggerType.Spam,
  preset: AutoModerationRuleTriggerType.KeywordPreset,
  mentions: AutoModerationRuleTriggerType.MentionSpam,
} as const;

function triggerMetadata(trigger: NativeTrigger) {
  switch (trigger.type) {
    case 'keyword':
      return { keyword_filter: trigger.keywords, regex_patterns: trigger.regexPatterns, allow_list: trigger.allowList };
    case 'preset':
      return { presets: trigger.presets.map((p) => PRESETS[p]), allow_list: trigger.allowList };
    case 'mentions':
      return { mention_total_limit: trigger.limit, mention_raid_protection_enabled: trigger.raidProtection };
    case 'spam':
      return {};
  }
}

/** The body Discord takes; the trigger type is set only on create — Discord does not change it. */
export function toDiscord(input: NativeRuleInput, { create }: { create: boolean }) {
  const actions = [
    ...(input.block ? [{ type: AutoModerationActionType.BlockMessage, metadata: input.blockMessage ? { custom_message: input.blockMessage } : {} }] : []),
    ...(input.alertChannelId ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel_id: input.alertChannelId } }] : []),
    ...(input.timeoutSec ? [{ type: AutoModerationActionType.Timeout, metadata: { duration_seconds: input.timeoutSec } }] : []),
  ];
  return {
    name: input.name,
    enabled: input.enabled,
    event_type: AutoModerationRuleEventType.MessageSend,
    ...(create ? { trigger_type: TRIGGER_TYPES[input.trigger.type] } : {}),
    trigger_metadata: triggerMetadata(input.trigger),
    actions,
    exempt_roles: input.exemptRoleIds,
    exempt_channels: input.exemptChannelIds,
  };
}
