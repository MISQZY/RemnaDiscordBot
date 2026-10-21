import { MessageTemplate, Snowflake } from '@bot/contracts';
import type { CustomCommand } from '@bot/db';
import { z } from 'zod';
import { regexProblem } from './matching.js';

export const CustomCommandsConfig = z.object({
  /** Auto-replies to messages (need the Message Content intent). Slash commands always work. */
  triggersEnabled: z.boolean(),
});
export type CustomCommandsConfig = z.infer<typeof CustomCommandsConfig>;

export const defaultCustomCommandsConfig: CustomCommandsConfig = { triggersEnabled: true };

/** Command limit per guild (Discord allows 100 guild commands per application). */
export const MAX_COMMANDS = 50;

export const MatchMode = z.enum(['exact', 'startsWith', 'contains', 'regex']);
export type MatchMode = z.infer<typeof MatchMode>;

const SLASH_NAME = /^[-_\p{Ll}\p{N}]{1,32}$/u;

/** An option's name: Discord's rule, and a placeholder's (a letter first, no `-`). */
const OPTION_NAME = /^\p{Ll}[\p{Ll}\p{N}_]{0,31}$/u;
/** Placeholder roots the reply already has: an option cannot take them. */
export const RESERVED_OPTION_NAMES = new Set(['user', 'member', 'guild', 'bot', 'channel', 'args']);
export const MAX_OPTIONS = 10;

export const OptionType = z.enum(['string', 'integer', 'number', 'boolean', 'user', 'channel', 'role']);
export type OptionType = z.infer<typeof OptionType>;

/** A slash command option: its value goes into the reply as `{name}`. */
export const CommandOption = z.object({
  name: z.string().regex(OPTION_NAME, 'Option names: a lowercase letter, then lowercase letters, digits or _ (up to 32)'),
  description: z.string().min(1).max(100),
  type: OptionType,
  required: z.boolean(),
});
export type CommandOption = z.infer<typeof CommandOption>;

export const CommandActions = z.object({
  addRoleIds: z.array(Snowflake).max(5),
  removeRoleIds: z.array(Snowflake).max(5),
  /** Delete the message that fired the trigger. */
  deleteTrigger: z.boolean(),
});
export type CommandActions = z.infer<typeof CommandActions>;

export const CommandInput = z
  .object({
    name: z.string().min(1).max(50),
    kind: z.enum(['slash', 'trigger']),
    description: z.string().max(100).nullable().default(null),
    matchMode: MatchMode.nullable().default(null),
    pattern: z.string().min(1).max(200).nullable().default(null),
    response: MessageTemplate,
    options: z.array(CommandOption).max(MAX_OPTIONS).default([]),
    /** Another channel for the reply; `null` — where the command was used. */
    responseChannelId: Snowflake.nullable().default(null),
    ephemeral: z.boolean().default(false),
    actions: CommandActions.default({ addRoleIds: [], removeRoleIds: [], deleteTrigger: false }),
    allowedChannelIds: z.array(Snowflake).max(25).default([]),
    allowedRoleIds: z.array(Snowflake).max(25).default([]),
    cooldownSec: z.number().int().min(0).max(86_400).default(0),
    enabled: z.boolean().default(true),
  })
  .superRefine((command, ctx) => {
    if (command.kind === 'slash') {
      if (!SLASH_NAME.test(command.name)) {
        ctx.addIssue({ code: 'custom', path: ['name'], message: 'Slash command names: 1–32 lowercase letters, digits, - or _' });
      }
      const seen = new Set<string>();
      command.options.forEach((option, i) => {
        if (RESERVED_OPTION_NAMES.has(option.name)) ctx.addIssue({ code: 'custom', path: ['options', i, 'name'], message: `{${option.name}} is a built-in placeholder` });
        else if (seen.has(option.name)) ctx.addIssue({ code: 'custom', path: ['options', i, 'name'], message: 'Option names must be unique' });
        seen.add(option.name);
      });
      return;
    }
    if (!command.matchMode || !command.pattern) {
      ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'Triggers need a match mode and a pattern' });
      return;
    }
    const problem = command.matchMode === 'regex' ? regexProblem(command.pattern) : null;
    if (problem) ctx.addIssue({ code: 'custom', path: ['pattern'], message: problem });
  });
export type CommandInput = z.infer<typeof CommandInput>;

export const CommandDto = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['slash', 'trigger']),
  description: z.string().nullable(),
  matchMode: MatchMode.nullable(),
  pattern: z.string().nullable(),
  response: MessageTemplate,
  options: z.array(CommandOption),
  responseChannelId: Snowflake.nullable(),
  ephemeral: z.boolean(),
  actions: CommandActions,
  allowedChannelIds: z.array(Snowflake),
  allowedRoleIds: z.array(Snowflake),
  cooldownSec: z.number().int(),
  enabled: z.boolean(),
  discordCommandId: z.string().nullable(),
  uses: z.number().int(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
});
export type CommandDto = z.infer<typeof CommandDto>;

export function toDto(row: CustomCommand): CommandDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CommandDto['kind'],
    description: row.description,
    matchMode: row.matchMode as MatchMode | null,
    pattern: row.pattern,
    response: MessageTemplate.parse(row.response),
    options: z.array(CommandOption).parse(row.options),
    responseChannelId: row.responseChannelId,
    ephemeral: row.ephemeral,
    actions: CommandActions.parse(row.actions),
    allowedChannelIds: z.array(Snowflake).parse(row.allowedChannelIds),
    allowedRoleIds: z.array(Snowflake).parse(row.allowedRoleIds),
    cooldownSec: row.cooldownSec,
    enabled: row.enabled,
    discordCommandId: row.discordCommandId,
    uses: row.uses,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}
