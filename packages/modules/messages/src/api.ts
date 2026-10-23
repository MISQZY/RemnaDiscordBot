import { MessageTemplate, Snowflake } from '@bot/contracts';
import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ScheduledDto, ScheduledInput, SendInput, SentMessage, StickyDto, StickyInput, type MessagesConfig } from './config.js';
import { MessageService } from './service.js';

const IdParams = z.object({ guildId: Snowflake, id: z.string() });
const ChannelParams = z.object({ guildId: Snowflake, channelId: Snowflake });

export function messagesApi(app: FastifyInstance, ctx: ApiModuleContext<MessagesConfig>): void {
  const service = new MessageService(ctx);
  const params = (request: FastifyRequest) => request.params as { guildId: string; id: string; channelId: string };

  async function checkChannel(guildId: string, channelId: string): Promise<void> {
    const checker = new EntityChecker(await ctx.guildEntities(guildId)).textChannel(channelId, ['channelId']);
    if (checker.issues.length > 0) throw HttpError.badRequest('Unknown or unusable channel', checker.issues);
  }

  app.get('/sent', { schema: { tags: ['messages'], summary: 'Messages posted from the dashboard, newest first', response: { 200: z.array(SentMessage) } } }, async (request) =>
    service.sent(params(request).guildId),
  );

  app.post('/sent', { schema: { tags: ['messages'], summary: 'Post a message as the bot', body: SendInput, response: { 201: SentMessage } } }, async (request, reply) => {
    const input = request.body as SendInput;
    await ctx.requireEnabled(params(request).guildId);
    await checkChannel(params(request).guildId, input.channelId);
    return reply.status(201).send(await service.send(params(request).guildId, input, ctx.currentUserId(request)));
  });

  app.put(
    '/sent/:id',
    { schema: { tags: ['messages'], summary: 'Edit a posted message', params: IdParams, body: z.object({ message: MessageTemplate }), response: { 200: SentMessage } } },
    async (request) => {
      await ctx.requireEnabled(params(request).guildId);
      return service.edit(params(request).guildId, params(request).id, (request.body as { message: MessageTemplate }).message);
    },
  );

  app.delete('/sent/:id', { schema: { tags: ['messages'], summary: 'Delete a posted message', params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
    await service.deleteSent(params(request).guildId, params(request).id);
    return reply.status(204).send(null);
  });

  app.get('/scheduled', { schema: { tags: ['messages'], summary: 'Scheduled messages', response: { 200: z.array(ScheduledDto) } } }, async (request) =>
    service.scheduledList(params(request).guildId),
  );

  app.post('/scheduled', { schema: { tags: ['messages'], summary: 'Schedule a message', body: ScheduledInput, response: { 201: ScheduledDto } } }, async (request, reply) => {
    const input = request.body as ScheduledInput;
    await checkChannel(params(request).guildId, input.channelId);
    return reply.status(201).send(await service.saveScheduled(params(request).guildId, null, input, ctx.currentUserId(request)));
  });

  app.put(
    '/scheduled/:id',
    { schema: { tags: ['messages'], summary: 'Update a scheduled message', params: IdParams, body: ScheduledInput, response: { 200: ScheduledDto } } },
    async (request) => {
      const input = request.body as ScheduledInput;
      await checkChannel(params(request).guildId, input.channelId);
      return service.saveScheduled(params(request).guildId, params(request).id, input, ctx.currentUserId(request));
    },
  );

  app.delete('/scheduled/:id', { schema: { tags: ['messages'], summary: 'Delete a scheduled message', params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
    await service.deleteScheduled(params(request).guildId, params(request).id);
    return reply.status(204).send(null);
  });

  app.get('/sticky', { schema: { tags: ['messages'], summary: 'Sticky messages', response: { 200: z.array(StickyDto) } } }, async (request) => service.stickyList(params(request).guildId));

  app.put(
    '/sticky/:channelId',
    { schema: { tags: ['messages'], summary: 'Keep a message at the bottom of the channel', params: ChannelParams, body: StickyInput, response: { 200: StickyDto } } },
    async (request) => {
      const input = request.body as StickyInput;
      // Turning a sticky message off only removes its copy; posting it waits for the module.
      if (input.enabled) await ctx.requireEnabled(params(request).guildId);
      await checkChannel(params(request).guildId, params(request).channelId);
      return service.saveSticky(params(request).guildId, params(request).channelId, input, ctx.currentUserId(request));
    },
  );

  app.delete(
    '/sticky/:channelId',
    { schema: { tags: ['messages'], summary: 'Stop keeping the sticky message', params: ChannelParams, response: { 204: z.null() } } },
    async (request, reply) => {
      await service.deleteSticky(params(request).guildId, params(request).channelId);
      return reply.status(204).send(null);
    },
  );
}
