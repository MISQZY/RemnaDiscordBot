import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import { isUniqueViolation, type Prisma } from '@bot/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CommandDto, CommandInput, MAX_COMMANDS, toDto, type CustomCommandsConfig } from './config.js';
import { DiscordCommandSync } from './discord-sync.js';

const CommandParams = z.object({ guildId: z.string(), commandId: z.string() });

export function customCommandsApi(app: FastifyInstance, ctx: ApiModuleContext<CustomCommandsConfig>): void {
  const sync = new DiscordCommandSync(ctx.rest);
  const params = (request: FastifyRequest) => request.params as { guildId: string; commandId?: string };

  async function findCommand(guildId: string, commandId: string) {
    const row = await ctx.db.customCommand.findUnique({ where: { id: commandId } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Command not found');
    return row;
  }

  async function validate(guildId: string, input: CommandInput): Promise<void> {
    const checker = new EntityChecker(await ctx.guildEntities(guildId))
      .channels(input.allowedChannelIds, ['allowedChannelIds'])
      .roles(input.allowedRoleIds, ['allowedRoleIds'])
      .roles(input.actions.addRoleIds, ['actions', 'addRoleIds'], { assignable: true })
      .roles(input.actions.removeRoleIds, ['actions', 'removeRoleIds'], { assignable: true });
    if (checker.issues.length > 0) throw HttpError.badRequest('Command references unknown or unusable channels or roles', checker.issues);
    if (input.kind === 'slash') await sync.assertNameFree(input.name);
  }

  const data = (input: CommandInput) => ({
    name: input.name,
    kind: input.kind,
    description: input.description,
    matchMode: input.kind === 'trigger' ? input.matchMode : null,
    pattern: input.kind === 'trigger' ? input.pattern : null,
    response: input.response as Prisma.InputJsonValue,
    ephemeral: input.ephemeral,
    actions: input.actions as Prisma.InputJsonValue,
    allowedChannelIds: input.allowedChannelIds,
    allowedRoleIds: input.allowedRoleIds,
    cooldownSec: input.cooldownSec,
    enabled: input.enabled,
  });

  /** Имя уже занято в гильдии — 409. */
  async function saving<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, 'CONFLICT', 'A command with this name already exists', [{ path: ['name'], message: 'Already exists' }]);
      }
      throw err;
    }
  }

  /** Приводит guild-команду в Discord к состоянию строки. */
  async function syncDiscord(guildId: string, id: string): Promise<CommandDto> {
    const command = toDto(await findCommand(guildId, id));
    const shouldExist = command.kind === 'slash' && command.enabled;
    let discordCommandId = command.discordCommandId;
    if (shouldExist) discordCommandId = await sync.upsert(guildId, command);
    else if (discordCommandId) {
      await sync.remove(guildId, discordCommandId);
      discordCommandId = null;
    }
    if (discordCommandId === command.discordCommandId) return command;
    return toDto(await ctx.db.customCommand.update({ where: { id }, data: { discordCommandId } }));
  }

  app.get(
    '/commands',
    { schema: { tags: ['custom-commands'], summary: 'Пользовательские команды', response: { 200: z.array(CommandDto) } } },
    async (request) => (await ctx.db.customCommand.findMany({ where: { guildId: params(request).guildId }, orderBy: { name: 'asc' } })).map(toDto),
  );

  app.post(
    '/commands',
    { schema: { tags: ['custom-commands'], summary: 'Создать команду', body: CommandInput, response: { 201: CommandDto } } },
    async (request, reply) => {
      const { guildId } = params(request);
      const input = request.body as CommandInput;
      if ((await ctx.db.customCommand.count({ where: { guildId } })) >= MAX_COMMANDS) {
        throw HttpError.badRequest(`A guild can have at most ${MAX_COMMANDS} custom commands`);
      }
      await validate(guildId, input);
      const row = await saving(ctx.db.customCommand.create({ data: { guildId, ...data(input), createdBy: ctx.currentUserId(request) } }));
      return reply.status(201).send(await syncDiscord(guildId, row.id));
    },
  );

  app.put(
    '/commands/:commandId',
    { schema: { tags: ['custom-commands'], summary: 'Изменить команду', params: CommandParams, body: CommandInput, response: { 200: CommandDto } } },
    async (request) => {
      const { guildId, commandId } = params(request);
      const existing = await findCommand(guildId, commandId!);
      const input = request.body as CommandInput;
      await validate(guildId, input);
      // Переименование slash-команды в Discord — это новая команда: старую удаляем.
      if (existing.discordCommandId && (existing.name !== input.name || input.kind !== 'slash')) {
        await sync.remove(guildId, existing.discordCommandId);
        await ctx.db.customCommand.update({ where: { id: existing.id }, data: { discordCommandId: null } });
      }
      await saving(ctx.db.customCommand.update({ where: { id: existing.id }, data: data(input) }));
      return syncDiscord(guildId, existing.id);
    },
  );

  app.delete(
    '/commands/:commandId',
    { schema: { tags: ['custom-commands'], summary: 'Удалить команду', params: CommandParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const { guildId, commandId } = params(request);
      const row = await findCommand(guildId, commandId!);
      if (row.discordCommandId) await sync.remove(guildId, row.discordCommandId);
      await ctx.db.customCommand.delete({ where: { id: row.id } });
      return reply.status(204).send(null);
    },
  );
}
