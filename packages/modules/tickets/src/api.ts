import { Snowflake } from '@bot/contracts';
import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import { UserDirectory, UserInfo } from '@bot/discord';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TicketDto, TicketPanel, TicketPanelInput, type TicketsConfig } from './config.js';
import { PanelService, toPanel } from './panel.js';
import { TicketService, toTicketDto } from './service.js';

const PanelParams = z.object({ guildId: Snowflake, panelId: z.string() });
const TicketParams = z.object({ guildId: Snowflake, number: z.coerce.number().int().min(1) });
const TicketsQuery = z.object({
  status: z.enum(['open', 'closed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Ticket number to continue from (exclusive) — newest first. */
  before: z.coerce.number().int().optional(),
});
const TicketsPage = z.object({ items: z.array(TicketDto), nextBefore: z.number().int().nullable(), users: z.record(z.string(), UserInfo) });

export function ticketsApi(app: FastifyInstance, ctx: ApiModuleContext<TicketsConfig>): void {
  const panels = new PanelService(ctx.db, ctx.rest);
  const tickets = new TicketService(ctx);
  const users = new UserDirectory(ctx.redis, ctx.rest);
  const params = (request: FastifyRequest) => request.params as { guildId: string; panelId: string };

  async function validate(guildId: string, input: TicketPanelInput): Promise<void> {
    const checker = new EntityChecker(await ctx.guildEntities(guildId)).textChannel(input.channelId, ['channelId']);
    input.categories.forEach((c, i) => checker.roles(c.supportRoleIds, ['categories', i, 'supportRoleIds']));
    if (checker.issues.length > 0) throw HttpError.badRequest('Panel references unknown channels or roles', checker.issues);
  }

  app.get('/panels', { schema: { tags: ['tickets'], summary: 'Ticket panels', response: { 200: z.array(TicketPanel) } } }, async (request) => panels.list(params(request).guildId));

  app.post('/panels', { schema: { tags: ['tickets'], summary: 'Create a ticket panel', body: TicketPanelInput, response: { 201: TicketPanel } } }, async (request, reply) => {
    const input = request.body as TicketPanelInput;
    await validate(params(request).guildId, input);
    return reply.status(201).send(await panels.create(params(request).guildId, input));
  });

  app.get('/panels/:panelId', { schema: { tags: ['tickets'], summary: 'Ticket panel', params: PanelParams, response: { 200: TicketPanel } } }, async (request) =>
    toPanel(await panels.find(params(request).guildId, params(request).panelId)),
  );

  app.put(
    '/panels/:panelId',
    { schema: { tags: ['tickets'], summary: 'Update a ticket panel; publish to update its message', params: PanelParams, body: TicketPanelInput, response: { 200: TicketPanel } } },
    async (request) => {
      const { guildId, panelId } = params(request);
      const input = request.body as TicketPanelInput;
      await panels.find(guildId, panelId);
      await validate(guildId, input);
      return panels.update(guildId, panelId, input);
    },
  );

  app.delete('/panels/:panelId', { schema: { tags: ['tickets'], summary: 'Delete a panel and its message', params: PanelParams, response: { 204: z.null() } } }, async (request, reply) => {
    await panels.delete(params(request).guildId, params(request).panelId);
    return reply.status(204).send(null);
  });

  app.post(
    '/panels/:panelId/publish',
    { schema: { tags: ['tickets'], summary: 'Post or update the panel message', params: PanelParams, response: { 200: TicketPanel } } },
    async (request) => panels.publish(params(request).guildId, params(request).panelId),
  );

  app.get('/tickets', { schema: { tags: ['tickets'], summary: 'Tickets, newest first', querystring: TicketsQuery, response: { 200: TicketsPage } } }, async (request) => {
    const { status, limit, before } = request.query as z.infer<typeof TicketsQuery>;
    const rows = await ctx.db.ticket.findMany({
      where: { guildId: params(request).guildId, status, ...(before ? { number: { lt: before } } : {}) },
      orderBy: { number: 'desc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return {
      items: items.map(toTicketDto),
      nextBefore: rows.length > limit ? items.at(-1)!.number : null,
      users: await users.resolve(items.flatMap((t) => [t.ownerId, t.claimedBy, t.closedBy === 'system' ? null : t.closedBy])),
    };
  });

  app.post(
    '/tickets/:number/close',
    {
      schema: {
        tags: ['tickets'],
        summary: 'Close a ticket: transcript to the log, the thread locked or the channel deleted',
        params: TicketParams,
        body: z.object({ reason: z.string().max(500).nullable().default(null) }),
        response: { 200: TicketDto },
      },
    },
    async (request) => {
      const { guildId, number } = TicketParams.parse(request.params);
      const ticket = await ctx.db.ticket.findUnique({ where: { guildId_number: { guildId, number } } });
      if (!ticket) throw HttpError.notFound('Ticket not found');
      if (ticket.status !== 'open') throw HttpError.badRequest('The ticket is closed already');
      const { reason } = request.body as { reason: string | null };
      return toTicketDto(await tickets.close(ticket, await ctx.getConfig(guildId), { by: ctx.currentUserId(request), reason }));
    },
  );
}
