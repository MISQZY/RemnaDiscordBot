import { MessageTemplate, Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const TicketsConfig = z.object({
  /** `thread` — a private thread of `parentChannelId`; `channel` — a channel in the `parentChannelId` category. */
  mode: z.enum(['thread', 'channel']),
  parentChannelId: Snowflake.nullable(),
  /** See and answer every ticket; a panel category may name its own. */
  supportRoleIds: z.array(Snowflake).max(10),
  /** Opened and closed tickets with their transcripts. */
  logChannelId: Snowflake.nullable(),
  maxOpenPerUser: z.number().int().min(1).max(10),
  /** Close a ticket nobody wrote in for this long; 0 — never. */
  autoCloseHours: z.number().int().min(0).max(720),
  /** The first message of a ticket. Placeholders: the member, `{ticket.number}`, `{ticket.category}`. */
  openMessage: MessageTemplate,
  /** Mention the support roles in a new ticket (in a thread it also adds them to it). */
  pingSupport: z.boolean(),
  /** A support member can take the ticket: "claimed by" is shown to everyone. */
  claimEnabled: z.boolean(),
  /** Send the transcript to the member when the ticket closes. */
  transcriptDm: z.boolean(),
});
export type TicketsConfig = z.infer<typeof TicketsConfig>;

export const defaultTicketsConfig: TicketsConfig = {
  mode: 'thread',
  parentChannelId: null,
  supportRoleIds: [],
  logChannelId: null,
  maxOpenPerUser: 1,
  autoCloseHours: 0,
  openMessage: { content: '{user.mention}, спасибо за обращение! Опишите проблему — команда поддержки скоро ответит.' },
  pingSupport: true,
  claimEnabled: true,
  transcriptDm: false,
};

export const ItemId = z.string().regex(/^[\w-]{1,32}$/);

export const TicketQuestion = z.object({
  id: ItemId.optional(),
  label: z.string().trim().min(1).max(45),
  placeholder: z.string().max(100).optional(),
  required: z.boolean(),
  /** A paragraph instead of one line. */
  long: z.boolean(),
});
export type TicketQuestion = z.infer<typeof TicketQuestion>;

export const TicketCategoryInput = z.object({
  id: ItemId.optional(),
  label: z.string().trim().min(1).max(80),
  emoji: z.string().max(64).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('primary'),
  description: z.string().max(100).optional(),
  /** Asked in a form before the ticket opens (Discord shows at most five). */
  questions: z.array(TicketQuestion).max(5),
  /** Instead of the module's support roles; empty — the module's. */
  supportRoleIds: z.array(Snowflake).max(10),
});
export type TicketCategoryInput = z.infer<typeof TicketCategoryInput>;

export const TicketCategory = TicketCategoryInput.extend({ id: ItemId, questions: z.array(TicketQuestion.extend({ id: ItemId })) });
export type TicketCategory = z.infer<typeof TicketCategory>;

export const MAX_PANELS = 10;

export const TicketPanelInput = z.object({
  channelId: Snowflake,
  kind: z.enum(['buttons', 'select']),
  message: MessageTemplate,
  categories: z.array(TicketCategoryInput).min(1).max(25),
});
export type TicketPanelInput = z.infer<typeof TicketPanelInput>;

export const TicketPanel = z.object({
  id: z.string(),
  guildId: Snowflake,
  channelId: Snowflake,
  messageId: Snowflake.nullable(),
  kind: z.enum(['buttons', 'select']),
  message: MessageTemplate,
  categories: z.array(TicketCategory),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TicketPanel = z.infer<typeof TicketPanel>;

export const TicketDto = z.object({
  number: z.number().int(),
  channelId: Snowflake,
  ownerId: Snowflake,
  categoryLabel: z.string().nullable(),
  status: z.enum(['open', 'closed']),
  claimedBy: z.string().nullable(),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  closedBy: z.string().nullable(),
  closeReason: z.string().nullable(),
});
export type TicketDto = z.infer<typeof TicketDto>;
