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

/** An info panel item's key in its `customId`s: kept across edits, so a posted message keeps working. */
export const InfoItemId = z.string().regex(/^[\w-]{1,32}$/);

export const InfoPanelItemInput = z.object({
  /** Missing on a new item — the service assigns one. */
  id: InfoItemId.optional(),
  label: z.string().min(1).max(80),
  /** A Unicode emoji or a custom `<:name:id>`. */
  emoji: z.string().max(64).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('secondary'),
  description: z.string().max(100).optional(),
  /** What the member who picked the item sees — only them. */
  reply: MessageTemplate,
});
export type InfoPanelItemInput = z.infer<typeof InfoPanelItemInput>;

export const InfoPanelItem = InfoPanelItemInput.extend({ id: InfoItemId });
export type InfoPanelItem = z.infer<typeof InfoPanelItem>;

export const MAX_INFO_PANELS = 25;

/** A panel whose items each show the member who picked them a message (rules, FAQ, links). */
export const InfoPanelInput = z
  .object({
    channelId: Snowflake,
    kind: PanelKind,
    message: MessageTemplate,
    items: z.array(InfoPanelItemInput).min(1).max(25),
  })
  .refine(
    (panel) => {
      const ids = panel.items.flatMap((i) => (i.id ? [i.id] : []));
      return new Set(ids).size === ids.length;
    },
    { message: 'Item ids must be unique', path: ['items'] },
  );
export type InfoPanelInput = z.infer<typeof InfoPanelInput>;

export const InfoPanel = z.object({
  id: z.string(),
  guildId: Snowflake,
  channelId: Snowflake,
  messageId: Snowflake.nullable(),
  kind: PanelKind,
  message: MessageTemplate,
  items: z.array(InfoPanelItem),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type InfoPanel = z.infer<typeof InfoPanel>;

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
