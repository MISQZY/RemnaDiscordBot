import { HttpError } from '@bot/core';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  DiscordAPIError,
  InteractionContextType,
  RESTJSONErrorCodes,
  Routes,
  type APIApplicationCommandOption,
  type REST,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { CommandDto, OptionType } from './config.js';

const OPTION_TYPES: Record<OptionType, ApplicationCommandOptionType> = {
  string: ApplicationCommandOptionType.String,
  integer: ApplicationCommandOptionType.Integer,
  number: ApplicationCommandOptionType.Number,
  boolean: ApplicationCommandOptionType.Boolean,
  user: ApplicationCommandOptionType.User,
  channel: ApplicationCommandOptionType.Channel,
  role: ApplicationCommandOptionType.Role,
};

/** Option name for `{args}` in a slash command without its own options. */
export const ARGS_OPTION = 'text';

const usesArgs = (command: Pick<CommandDto, 'response'>) => JSON.stringify(command.response).includes('{args}');

export function slashCommandBody(command: Pick<CommandDto, 'name' | 'description' | 'response' | 'options'>): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return {
    type: ApplicationCommandType.ChatInput,
    name: command.name,
    description: command.description || 'Custom command',
    contexts: [InteractionContextType.Guild],
    options: command.options.length
      ? // Discord takes the required options first.
        [...command.options]
          .sort((a, b) => Number(b.required) - Number(a.required))
          .map((o) => ({ type: OPTION_TYPES[o.type], name: o.name, description: o.description, required: o.required, ...(o.type === 'string' ? { max_length: 1000 } : {}) }) as APIApplicationCommandOption)
      : usesArgs(command)
        ? [{ type: ApplicationCommandOptionType.String, name: ARGS_OPTION, description: 'Text', required: false, max_length: 500 }]
        : [],
  };
}

/** Syncs custom slash commands with Discord via REST (guild commands). */
export class DiscordCommandSync {
  private applicationId: Promise<string> | undefined;
  private globalNames: { names: Set<string>; expiresAt: number } | undefined;

  constructor(private readonly rest: REST) {}

  /** Names of the bot's global commands — custom commands cannot take them. */
  async reservedNames(): Promise<Set<string>> {
    if (this.globalNames && this.globalNames.expiresAt > Date.now()) return this.globalNames.names;
    const commands = (await this.rest.get(Routes.applicationCommands(await this.appId()))) as { name: string }[];
    this.globalNames = { names: new Set(commands.map((c) => c.name)), expiresAt: Date.now() + 5 * 60_000 };
    return this.globalNames.names;
  }

  async assertNameFree(name: string): Promise<void> {
    if ((await this.reservedNames()).has(name)) {
      throw HttpError.badRequest('This name is used by a built-in command', [{ path: ['name'], message: `/${name} already exists` }]);
    }
  }

  /** Creates or updates the command; returns its Discord ID. */
  async upsert(guildId: string, command: Pick<CommandDto, 'name' | 'description' | 'response' | 'options' | 'discordCommandId'>): Promise<string> {
    const appId = await this.appId();
    const body = slashCommandBody(command);
    if (command.discordCommandId) {
      try {
        await this.rest.patch(Routes.applicationGuildCommand(appId, guildId, command.discordCommandId), { body });
        return command.discordCommandId;
      } catch (err) {
        // The command was deleted in Discord manually — create it again.
        if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownApplicationCommand)) throw err;
      }
    }
    const created = (await this.rest.post(Routes.applicationGuildCommands(appId, guildId), { body })) as { id: string };
    return created.id;
  }

  async remove(guildId: string, discordCommandId: string): Promise<void> {
    try {
      await this.rest.delete(Routes.applicationGuildCommand(await this.appId(), guildId, discordCommandId));
    } catch (err) {
      if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownApplicationCommand)) throw err;
    }
  }

  private appId(): Promise<string> {
    this.applicationId ??= (this.rest.get(Routes.currentApplication()) as Promise<{ id: string }>).then((app) => app.id);
    return this.applicationId;
  }
}
