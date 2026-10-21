import type { ModuleServices } from '@bot/core';
import type { TicketsConfig } from './config.js';
import { TicketService } from './service.js';

/** The shortest auto-close is an hour: older activity is all that can be due. */
const MIN_IDLE_MS = 3600_000;
const BATCH = 50;

/** Closes tickets nobody wrote in for longer than their server allows. Run by the worker. */
export async function autoClose(ctx: ModuleServices<TicketsConfig>, now = Date.now()): Promise<number> {
  const idle = await ctx.db.ticket.findMany({
    where: { status: 'open', lastActivityAt: { lt: new Date(now - MIN_IDLE_MS) } },
    orderBy: { lastActivityAt: 'asc' },
    take: BATCH,
  });
  const service = new TicketService(ctx);
  let closed = 0;
  for (const ticket of idle) {
    if (!(await ctx.config.isEnabled(ticket.guildId, 'tickets'))) continue;
    const config = await ctx.getConfig(ticket.guildId);
    if (config.autoCloseHours === 0 || ticket.lastActivityAt.getTime() > now - config.autoCloseHours * 3600_000) continue;
    try {
      const t = await service.translator(ticket.guildId);
      await service.close(ticket, config, { by: 'system', reason: t('tickets.autoClosed', { hours: config.autoCloseHours }) });
      closed++;
    } catch (err) {
      ctx.logger.warn({ err, ticketId: ticket.id }, 'Auto-close of a ticket failed');
    }
  }
  return closed;
}
