import { EntityChecker, HttpError, type CoreServices, type GuildEntities } from '@bot/core';
import { isUniqueViolation, type CustomCommand, type Prisma } from '@bot/db';
import { MAX_COMMANDS, toDto, type CommandDto, type CommandInput } from './config.js';
import { DiscordCommandSync } from './discord-sync.js';

/** Why a change was refused — the bot turns it into a localized reply, the API into an HTTP error. */
export type CommandProblem = 'limit' | 'conflict' | 'reserved' | 'references' | 'notFound';

export class CommandError extends HttpError {
  constructor(
    readonly problem: CommandProblem,
    error: HttpError,
  ) {
    super(error.statusCode, error.code, error.message, error.details);
  }
}

const data = (input: CommandInput) => ({
  name: input.name,
  kind: input.kind,
  description: input.description,
  matchMode: input.kind === 'trigger' ? input.matchMode : null,
  pattern: input.kind === 'trigger' ? input.pattern : null,
  response: input.response as Prisma.InputJsonValue,
  options: (input.kind === 'slash' ? input.options : []) as Prisma.InputJsonValue,
  responseChannelId: input.responseChannelId,
  ephemeral: input.ephemeral,
  actions: input.actions as Prisma.InputJsonValue,
  allowedChannelIds: input.allowedChannelIds,
  allowedRoleIds: input.allowedRoleIds,
  cooldownSec: input.cooldownSec,
  enabled: input.enabled,
});

/** Custom commands of a guild: the rows and their guild commands in Discord. Shared by the API and the bot. */
export class CustomCommandService {
  private readonly sync: DiscordCommandSync;

  constructor(private readonly services: Pick<CoreServices, 'db' | 'rest'>) {
    this.sync = new DiscordCommandSync(services.rest);
  }

  async list(guildId: string): Promise<CommandDto[]> {
    return (await this.services.db.customCommand.findMany({ where: { guildId }, orderBy: { name: 'asc' } })).map(toDto);
  }

  async find(guildId: string, commandId: string): Promise<CustomCommand> {
    const row = await this.services.db.customCommand.findUnique({ where: { id: commandId } });
    if (!row || row.guildId !== guildId) throw new CommandError('notFound', HttpError.notFound('Command not found'));
    return row;
  }

  async create(guildId: string, input: CommandInput, createdBy: string, entities: GuildEntities): Promise<CommandDto> {
    if ((await this.services.db.customCommand.count({ where: { guildId } })) >= MAX_COMMANDS) {
      throw new CommandError('limit', HttpError.badRequest(`A guild can have at most ${MAX_COMMANDS} custom commands`));
    }
    await this.validate(input, entities);
    const row = await this.saving(this.services.db.customCommand.create({ data: { guildId, ...data(input), createdBy } }));
    return this.syncDiscord(guildId, row.id);
  }

  async update(guildId: string, commandId: string, input: CommandInput, entities: GuildEntities): Promise<CommandDto> {
    const existing = await this.find(guildId, commandId);
    await this.validate(input, entities);
    // Renaming a slash command in Discord means a new command: delete the old one.
    if (existing.discordCommandId && (existing.name !== input.name || input.kind !== 'slash')) {
      await this.sync.remove(guildId, existing.discordCommandId);
      await this.services.db.customCommand.update({ where: { id: existing.id }, data: { discordCommandId: null } });
    }
    await this.saving(this.services.db.customCommand.update({ where: { id: existing.id }, data: data(input) }));
    return this.syncDiscord(guildId, existing.id);
  }

  async remove(guildId: string, commandId: string): Promise<void> {
    const row = await this.find(guildId, commandId);
    if (row.discordCommandId) await this.sync.remove(guildId, row.discordCommandId);
    await this.services.db.customCommand.delete({ where: { id: row.id } });
  }

  private async validate(input: CommandInput, entities: GuildEntities): Promise<void> {
    const checker = new EntityChecker(entities)
      .textChannel(input.responseChannelId, ['responseChannelId'])
      .channels(input.allowedChannelIds, ['allowedChannelIds'])
      .roles(input.allowedRoleIds, ['allowedRoleIds'])
      .roles(input.actions.addRoleIds, ['actions', 'addRoleIds'], { assignable: true })
      .roles(input.actions.removeRoleIds, ['actions', 'removeRoleIds'], { assignable: true });
    if (checker.issues.length > 0) {
      throw new CommandError('references', HttpError.badRequest('Command references unknown or unusable channels or roles', checker.issues));
    }
    if (input.kind === 'slash') {
      try {
        await this.sync.assertNameFree(input.name);
      } catch (err) {
        throw err instanceof HttpError ? new CommandError('reserved', err) : err;
      }
    }
  }

  /** The name is already taken in the guild — 409. */
  private async saving<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new CommandError(
          'conflict',
          new HttpError(409, 'CONFLICT', 'A command with this name already exists', [{ path: ['name'], message: 'Already exists' }]),
        );
      }
      throw err;
    }
  }

  /** Brings the guild command in Discord in line with the row. */
  private async syncDiscord(guildId: string, id: string): Promise<CommandDto> {
    const command = toDto(await this.find(guildId, id));
    const shouldExist = command.kind === 'slash' && command.enabled;
    let discordCommandId = command.discordCommandId;
    if (shouldExist) discordCommandId = await this.sync.upsert(guildId, command);
    else if (discordCommandId) {
      await this.sync.remove(guildId, discordCommandId);
      discordCommandId = null;
    }
    if (discordCommandId === command.discordCommandId) return command;
    return toDto(await this.services.db.customCommand.update({ where: { id }, data: { discordCommandId } }));
  }
}
