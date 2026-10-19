import { MessageTemplate, Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const AutorolesConfig = z.object({
  joinRoles: z.object({
    humans: z.array(Snowflake).max(10),
    bots: z.array(Snowflake).max(10),
    /** Grant delay — so members who join and leave right away (or skip the rules) do not get the role. */
    delaySec: z.number().int().min(0).max(3600),
  }),
  persistence: z.object({
    enabled: z.boolean(),
    /** Which roles to keep: all, only listed ones, or all except listed ones. */
    mode: z.enum(['all', 'whitelist', 'blacklist']),
    roleIds: z.array(Snowflake).max(50),
  }),
});
export type AutorolesConfig = z.infer<typeof AutorolesConfig>;

export const defaultAutorolesConfig: AutorolesConfig = {
  joinRoles: { humans: [], bots: [], delaySec: 0 },
  persistence: { enabled: false, mode: 'all', roleIds: [] },
};

export const PanelKind = z.enum(['buttons', 'select']);
/** toggle — a click adds or removes; add/remove — only one of them; unique — one role from the panel. */
export const PanelMode = z.enum(['toggle', 'add', 'remove', 'unique']);

export const PanelItem = z.object({
  roleId: Snowflake,
  label: z.string().min(1).max(80),
  /** A Unicode emoji or a custom `<:name:id>`. */
  emoji: z.string().max(64).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('secondary'),
  description: z.string().max(100).optional(),
});
export type PanelItem = z.infer<typeof PanelItem>;

export const PanelInput = z
  .object({
    channelId: Snowflake,
    kind: PanelKind,
    mode: PanelMode,
    maxRoles: z.number().int().min(1).max(25).nullable().default(null),
    message: MessageTemplate,
    items: z.array(PanelItem).min(1).max(25),
  })
  .refine((panel) => new Set(panel.items.map((i) => i.roleId)).size === panel.items.length, {
    message: 'Each role can appear in a panel only once',
    path: ['items'],
  });
export type PanelInput = z.infer<typeof PanelInput>;

export const Panel = z.object({
  id: z.string(),
  guildId: Snowflake,
  channelId: Snowflake,
  messageId: Snowflake.nullable(),
  kind: PanelKind,
  mode: PanelMode,
  maxRoles: z.number().int().nullable(),
  message: MessageTemplate,
  items: z.array(PanelItem),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Panel = z.infer<typeof Panel>;
