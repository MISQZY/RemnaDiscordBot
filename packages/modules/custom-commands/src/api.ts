import { Snowflake } from '@bot/contracts';
import type { ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CommandDto, CommandInput, type CustomCommandsConfig } from './config.js';
import { CustomCommandService } from './service.js';

const CommandParams = z.object({ guildId: Snowflake, commandId: z.string() });

export function customCommandsApi(app: FastifyInstance, ctx: ApiModuleContext<CustomCommandsConfig>): void {
  const service = new CustomCommandService(ctx);
  const params = (request: FastifyRequest) => request.params as { guildId: string; commandId: string };

  app.get(
    '/commands',
    { schema: { tags: ['custom-commands'], summary: 'Custom commands', response: { 200: z.array(CommandDto) } } },
    async (request) => service.list(params(request).guildId),
  );

  app.post(
    '/commands',
    { schema: { tags: ['custom-commands'], summary: 'Create a command', body: CommandInput, response: { 201: CommandDto } } },
    async (request, reply) => {
      const { guildId } = params(request);
      const created = await service.create(guildId, request.body as CommandInput, ctx.currentUserId(request), await ctx.guildEntities(guildId));
      return reply.status(201).send(created);
    },
  );

  app.put(
    '/commands/:commandId',
    { schema: { tags: ['custom-commands'], summary: 'Update a command', params: CommandParams, body: CommandInput, response: { 200: CommandDto } } },
    async (request) => {
      const { guildId, commandId } = params(request);
      return service.update(guildId, commandId, request.body as CommandInput, await ctx.guildEntities(guildId));
    },
  );

  app.delete(
    '/commands/:commandId',
    { schema: { tags: ['custom-commands'], summary: 'Delete a command', params: CommandParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const { guildId, commandId } = params(request);
      await service.remove(guildId, commandId);
      return reply.status(204).send(null);
    },
  );
}
