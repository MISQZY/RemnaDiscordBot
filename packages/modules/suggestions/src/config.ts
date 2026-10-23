import { Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const SuggestionsConfig = z.object({
  /**
   * `channel` — a message in a text channel (with a thread under it when `threads`); `forum` — a post of its own in a
   * forum, its status shown by the forum's tags. Configs from before the forum have no mode: a channel.
   */
  mode: z.enum(['channel', 'forum']).default('channel'),
  /** Where suggestions are posted and voted on; `null` — /suggest is off. */
  channelId: Snowflake.nullable(),
  /** Besides those with Manage Server, these roles decide on suggestions. */
  reviewerRoleIds: z.array(Snowflake).max(10),
  /** Hide who suggested from everyone but the reviewers. */
  anonymous: z.boolean(),
  /** A thread under each suggestion to discuss it (a forum post is a thread already). */
  threads: z.boolean(),
  /** Tell the author about the decision in DMs. */
  dmOnDecision: z.boolean(),
});
export type SuggestionsConfig = z.infer<typeof SuggestionsConfig>;

export const defaultSuggestionsConfig: SuggestionsConfig = { mode: 'channel', channelId: null, reviewerRoleIds: [], anonymous: false, threads: true, dmOnDecision: true };

export const STATUSES = ['pending', 'considered', 'approved', 'denied', 'implemented'] as const;
export const SuggestionStatus = z.enum(STATUSES);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

export const SuggestionDto = z.object({
  number: z.number().int(),
  authorId: Snowflake,
  content: z.string(),
  channelId: Snowflake,
  messageId: Snowflake.nullable(),
  status: SuggestionStatus,
  reviewerId: z.string().nullable(),
  response: z.string().nullable(),
  upvotes: z.number().int(),
  downvotes: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SuggestionDto = z.infer<typeof SuggestionDto>;
