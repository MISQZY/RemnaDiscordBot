import { MessageTemplate } from '@bot/contracts';
import { HttpError, type CoreServices } from '@bot/core';
import type { Prisma, ScheduledMessage, StickyMessage } from '@bot/db';
import { guildVars, renderMessage, toRestMessage } from '@bot/templates';
import { DiscordAPIError, RESTJSONErrorCodes, Routes, type APIGuild } from 'discord.js';
import {
  MAX_SCHEDULED,
  MAX_STICKY,
  type ScheduledDto,
  type ScheduledInput,
  type SendInput,
  type SentMessage,
  type StickyDto,
  type StickyInput,
} from './config.js';

type Services = Pick<CoreServices, 'db' | 'rest' | 'redis' | 'scheduler' | 'logger'>;

export const scheduledKey = (id: string) => `messages:scheduled:${id}`;
export const reminderKey = (id: string) => `messages:remind:${id}`;
/** Set while a channel has a sticky message: lets every message be checked without the database. */
export const stickyKey = (channelId: string) => `messages:sticky:${channelId}`;

const unknownMessage = (err: unknown) => err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage;

/** The next run of a repeating message after `now`: missed runs (the worker was down) are skipped, not sent in a row. */
export function nextRun(from: Date, intervalMin: number, now = new Date()): Date | null {
  if (intervalMin === 0) return null;
  const step = intervalMin * 60_000;
  let next = from.getTime() + step;
  if (next <= now.getTime()) next += Math.ceil((now.getTime() - next + 1) / step) * step;
  return new Date(next);
}

export function toScheduledDto(row: ScheduledMessage): ScheduledDto {
  return {
    id: row.id,
    channelId: row.channelId,
    message: MessageTemplate.parse(row.message),
    nextRunAt: row.nextRunAt.toISOString(),
    intervalMin: row.intervalMin as ScheduledDto['intervalMin'],
    enabled: row.enabled,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdBy: row.createdBy,
  };
}

export function toStickyDto(row: StickyMessage): StickyDto {
  return { channelId: row.channelId, message: MessageTemplate.parse(row.message), enabled: row.enabled, lastMessageId: row.lastMessageId, updatedAt: row.updatedAt.toISOString() };
}

/** Messages of the bot via REST: posted from the dashboard, on schedule, sticky — the same in the bot, the API and the worker. */
export class MessageService {
  constructor(private readonly services: Services) {}

  /** The template rendered with the server's placeholders (`{guild.name}`, `{guild.memberCount}`…). */
  async body(guildId: string, message: MessageTemplate) {
    const guild = (await this.services.rest.get(Routes.guild(guildId), { query: new URLSearchParams({ with_counts: 'true' }) }).catch(() => null)) as
      | (APIGuild & { approximate_member_count?: number })
      | null;
    const vars = guild ? guildVars({ id: guild.id, name: guild.name, memberCount: guild.approximate_member_count ?? 0 }) : {};
    return toRestMessage(renderMessage(message, vars));
  }

  // Posted from the dashboard.

  async sent(guildId: string): Promise<SentMessage[]> {
    const rows = await this.services.db.botMessage.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => ({ ...r, message: MessageTemplate.parse(r.message), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
  }

  async send(guildId: string, input: SendInput, by: string): Promise<SentMessage> {
    const posted = (await this.services.rest.post(Routes.channelMessages(input.channelId), { body: await this.body(guildId, input.message) })) as { id: string };
    const row = await this.services.db.botMessage.create({
      data: { guildId, channelId: input.channelId, messageId: posted.id, message: input.message as Prisma.InputJsonValue, createdBy: by },
    });
    return { ...row, message: input.message, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async edit(guildId: string, id: string, message: MessageTemplate): Promise<SentMessage> {
    const row = await this.services.db.botMessage.findUnique({ where: { id } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Message not found');
    try {
      await this.services.rest.patch(Routes.channelMessage(row.channelId, row.messageId), { body: await this.body(guildId, message) });
    } catch (err) {
      if (!unknownMessage(err)) throw err;
      throw HttpError.badRequest('The message was deleted in Discord');
    }
    const updated = await this.services.db.botMessage.update({ where: { id }, data: { message: message as Prisma.InputJsonValue } });
    return { ...updated, message, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() };
  }

  async deleteSent(guildId: string, id: string): Promise<void> {
    const row = await this.services.db.botMessage.findUnique({ where: { id } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Message not found');
    await this.services.rest.delete(Routes.channelMessage(row.channelId, row.messageId)).catch((err: unknown) => {
      if (!unknownMessage(err)) throw err;
    });
    await this.services.db.botMessage.delete({ where: { id } });
  }

  // On schedule.

  async scheduledList(guildId: string): Promise<ScheduledDto[]> {
    return (await this.services.db.scheduledMessage.findMany({ where: { guildId }, orderBy: { nextRunAt: 'asc' } })).map(toScheduledDto);
  }

  async saveScheduled(guildId: string, id: string | null, input: ScheduledInput, by: string): Promise<ScheduledDto> {
    const { db } = this.services;
    const nextRunAt = new Date(input.nextRunAt);
    if (input.enabled && nextRunAt.getTime() < Date.now() - 60_000) throw HttpError.badRequest('The time is in the past', [{ path: ['nextRunAt'], message: 'In the past' }]);
    const data = { channelId: input.channelId, message: input.message as Prisma.InputJsonValue, nextRunAt, intervalMin: input.intervalMin, enabled: input.enabled };
    let row: ScheduledMessage;
    if (id) {
      const current = await db.scheduledMessage.findUnique({ where: { id } });
      if (!current || current.guildId !== guildId) throw HttpError.notFound('Scheduled message not found');
      row = await db.scheduledMessage.update({ where: { id }, data });
    } else {
      if ((await db.scheduledMessage.count({ where: { guildId } })) >= MAX_SCHEDULED) throw HttpError.badRequest(`A server can have at most ${MAX_SCHEDULED} scheduled messages`);
      row = await db.scheduledMessage.create({ data: { guildId, createdBy: by, ...data } });
    }
    await this.plan(row);
    return toScheduledDto(row);
  }

  async deleteScheduled(guildId: string, id: string): Promise<void> {
    const row = await this.services.db.scheduledMessage.findUnique({ where: { id } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Scheduled message not found');
    await this.services.scheduler.cancel(scheduledKey(id));
    await this.services.db.scheduledMessage.delete({ where: { id } });
  }

  /** Posts a due scheduled message and plans the next run of a repeating one. */
  async runScheduled(id: string, now = new Date()): Promise<void> {
    const { db, rest, logger } = this.services;
    const row = await db.scheduledMessage.findUnique({ where: { id } });
    if (!row?.enabled) return;
    try {
      await rest.post(Routes.channelMessages(row.channelId), { body: await this.body(row.guildId, MessageTemplate.parse(row.message)) });
    } catch (err) {
      // A deleted channel or lost access: the run is skipped, the next one still planned.
      logger.warn({ err, id }, 'Scheduled message not posted');
    }
    const next = nextRun(row.nextRunAt, row.intervalMin, now);
    const updated = await db.scheduledMessage.update({ where: { id }, data: { lastRunAt: now, ...(next ? { nextRunAt: next } : { enabled: false }) } });
    await this.plan(updated);
  }

  private async plan(row: ScheduledMessage): Promise<void> {
    if (!row.enabled) {
      await this.services.scheduler.cancel(scheduledKey(row.id));
      return;
    }
    await this.services.scheduler.schedule({ guildId: row.guildId, moduleId: 'messages', job: 'scheduled', payload: { id: row.id }, runAt: row.nextRunAt, key: scheduledKey(row.id) });
  }

  // Sticky.

  async stickyList(guildId: string): Promise<StickyDto[]> {
    return (await this.services.db.stickyMessage.findMany({ where: { guildId }, orderBy: { updatedAt: 'desc' } })).map(toStickyDto);
  }

  async saveSticky(guildId: string, channelId: string, input: StickyInput, by: string): Promise<StickyDto> {
    const { db, redis } = this.services;
    const existing = await db.stickyMessage.findUnique({ where: { channelId } });
    if (existing && existing.guildId !== guildId) throw HttpError.notFound('Channel not found');
    if (!existing && (await db.stickyMessage.count({ where: { guildId } })) >= MAX_STICKY) throw HttpError.badRequest(`A server can have at most ${MAX_STICKY} sticky messages`);
    const data = { message: input.message as Prisma.InputJsonValue, enabled: input.enabled };
    await db.stickyMessage.upsert({ where: { channelId }, create: { channelId, guildId, createdBy: by, ...data }, update: data });
    if (input.enabled) {
      await redis.set(stickyKey(channelId), '1');
      return toStickyDto(await this.repost(channelId));
    }
    await redis.del(stickyKey(channelId));
    return toStickyDto(await this.removeCopy(channelId));
  }

  async deleteSticky(guildId: string, channelId: string): Promise<void> {
    const row = await this.services.db.stickyMessage.findUnique({ where: { channelId } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Sticky message not found');
    await this.services.redis.del(stickyKey(channelId));
    await this.removeCopy(channelId);
    await this.services.db.stickyMessage.delete({ where: { channelId } });
  }

  /** Posts the sticky message again at the bottom, removing its previous copy. */
  async repost(channelId: string): Promise<StickyMessage> {
    const { db, rest } = this.services;
    const row = await this.removeCopy(channelId);
    if (!row.enabled) return row;
    const posted = (await rest.post(Routes.channelMessages(channelId), { body: await this.body(row.guildId, MessageTemplate.parse(row.message)) })) as { id: string };
    return db.stickyMessage.update({ where: { channelId }, data: { lastMessageId: posted.id } });
  }

  private async removeCopy(channelId: string): Promise<StickyMessage> {
    const row = await this.services.db.stickyMessage.findUniqueOrThrow({ where: { channelId } });
    if (!row.lastMessageId) return row;
    await this.services.rest.delete(Routes.channelMessage(channelId, row.lastMessageId)).catch(() => undefined);
    return this.services.db.stickyMessage.update({ where: { channelId }, data: { lastMessageId: null } });
  }
}
