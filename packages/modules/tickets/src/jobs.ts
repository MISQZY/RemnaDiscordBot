import type { ModuleServices } from '@bot/core';
import type { TicketsConfig } from './config.js';
import { TicketService } from './service.js';

/** The shortest auto-close is an hour: older activity is all that can be due. */
const MIN_IDLE_MS = 3600_000;
/** Tickets closed per run, and the most looked at: each close is several Discord calls. */
const BATCH = 50;
const MAX_SCANNED = 1000;

/**
 * Closes tickets nobody wrote in for longer than their server allows. Run by the worker. The oldest idle tickets come
 * first, page by page: a page full of tickets whose server never auto-closes is passed, not looked at again and again.
 */
export async function autoClose(ctx: ModuleServices<TicketsConfig>, now = Date.now()): Promise<number> {
  const service = new TicketService(ctx);
  const configs = new Map<string, TicketsConfig | null>();
  const configOf = async (guildId: string) => {
    if (!configs.has(guildId)) configs.set(guildId, (await ctx.config.isEnabled(guildId, 'tickets')) ? await ctx.getConfig(guildId) : null);
    return configs.get(guildId)!;
  };
  let closed = 0;
  let cursor: string | undefined;
  for (let scanned = 0; closed < BATCH && scanned < MAX_SCANNED; ) {
    const idle = await ctx.db.ticket.findMany({
      where: { status: 'open', lastActivityAt: { lt: new Date(now - MIN_IDLE_MS) } },
      orderBy: [{ lastActivityAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (idle.length === 0) break;
    scanned += idle.length;
    cursor = idle.at(-1)!.id;
    for (const ticket of idle) {
      if (closed >= BATCH) break;
      const config = await configOf(ticket.guildId);
      if (!config || config.autoCloseHours === 0 || ticket.lastActivityAt.getTime() > now - config.autoCloseHours * 3600_000) continue;
      try {
        const t = await service.translator(ticket.guildId);
        await service.close(ticket, config, { by: 'system', reason: t('tickets.autoClosed', { hours: config.autoCloseHours }) });
        closed++;
      } catch (err) {
        ctx.logger.warn({ err, ticketId: ticket.id }, 'Auto-close of a ticket failed');
      }
    }
  }
  return closed;
}
