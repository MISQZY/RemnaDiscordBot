import type { CoreServices } from '@bot/core';
import type { Prisma, Ticket } from '@bot/db';
import { renderMessage, toRestMessage, type TemplateVars } from '@bot/templates';
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  Routes,
  type APIMessage,
  type APIUser,
} from 'discord.js';
import { z } from 'zod';
import type { TicketCategory, TicketDto, TicketsConfig } from './config.js';
import { PREFIX } from './panel.js';

type Services = Pick<CoreServices, 'db' | 'rest' | 'redis' | 'logger' | 'i18n' | 'guildLocales'>;
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** An open ticket's channel → its id: lets messages be checked without the database. */
export const channelKey = (channelId: string) => `tickets:channel:${channelId}`;

const Answers = z.array(z.object({ question: z.string(), answer: z.string() }));

export function toTicketDto(row: Ticket): TicketDto {
  return {
    number: row.number,
    channelId: row.channelId,
    ownerId: row.ownerId,
    categoryLabel: row.categoryLabel,
    status: row.status as TicketDto['status'],
    claimedBy: row.claimedBy,
    answers: Answers.parse(row.answers),
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    closedBy: row.closedBy,
    closeReason: row.closeReason,
  };
}

/** The ticket's name in Discord: `ticket-0042`. */
export const ticketName = (number: number) => `ticket-${String(number).padStart(4, '0')}`;

/** Support roles of a category: its own, or the module's. */
export const supportRolesOf = (config: TicketsConfig, category: Pick<TicketCategory, 'supportRoleIds'> | null) =>
  category && category.supportRoleIds.length > 0 ? category.supportRoleIds : config.supportRoleIds;

const MEMBER_ALLOW = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.AttachFiles | PermissionFlagsBits.EmbedLinks;

/** Plain text of a ticket's messages, oldest first — what is kept after the ticket is gone. */
export function formatTranscript(header: string[], messages: readonly Pick<APIMessage, 'author' | 'content' | 'timestamp' | 'attachments' | 'embeds'>[]): string {
  const lines = messages.map((m) => {
    const when = m.timestamp.slice(0, 16).replace('T', ' ');
    const parts = [m.content, ...m.embeds.map((e) => [e.title, e.description].filter(Boolean).join(' — ')).filter(Boolean).map((e) => `[embed] ${e}`), ...m.attachments.map((a) => `[file] ${a.url}`)];
    return `[${when}] ${m.author.username}: ${parts.filter(Boolean).join('\n    ')}`;
  });
  return [...header, '', ...lines].join('\n');
}

export class TicketService {
  private botId: Promise<string> | undefined;

  constructor(private readonly services: Services) {}

  async translator(guildId: string): Promise<Translate> {
    const locale = await this.services.guildLocales.get(guildId);
    return (key, vars) => this.services.i18n.t(locale, key, vars);
  }

  openCount(guildId: string, ownerId: string): Promise<number> {
    return this.services.db.ticket.count({ where: { guildId, ownerId, status: 'open' } });
  }

  findOpenByOwner(guildId: string, ownerId: string): Promise<Ticket | null> {
    return this.services.db.ticket.findFirst({ where: { guildId, ownerId, status: 'open' }, orderBy: { createdAt: 'desc' } });
  }

  /** The ticket's channel is gone: closed by the system, without a transcript — there is nothing left to read. */
  async markGone(ticket: Ticket): Promise<void> {
    await this.services.db.ticket.updateMany({ where: { id: ticket.id, status: 'open' }, data: { status: 'closed', closedAt: new Date(), closedBy: 'system' } });
    await this.services.redis.del(channelKey(ticket.channelId));
  }

  /** Closes the member's open tickets whose channel no longer exists in Discord. */
  async closeGone(guildId: string, ownerId: string): Promise<void> {
    const open = await this.services.db.ticket.findMany({ where: { guildId, ownerId, status: 'open' } });
    for (const ticket of open) {
      try {
        await this.services.rest.get(Routes.channel(ticket.channelId));
      } catch (err) {
        if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownChannel) await this.markGone(ticket);
      }
    }
  }

  /** Opens a ticket: a private thread or a channel, its first message, the log entry. */
  async open(input: {
    guildId: string;
    owner: { id: string; vars: TemplateVars };
    config: TicketsConfig;
    panelId: string | null;
    category: TicketCategory | null;
    answers: { question: string; answer: string }[];
  }): Promise<Ticket> {
    const { db, rest } = this.services;
    const { guildId, owner, config, category } = input;
    if (!config.parentChannelId) throw new Error('Tickets have no parent channel');
    const t = await this.translator(guildId);
    const counter = await db.ticketCounter.upsert({ where: { guildId }, create: { guildId, last: 1 }, update: { last: { increment: 1 } } });
    const number = counter.last;
    const support = supportRolesOf(config, category);

    let channelId: string;
    if (config.mode === 'thread') {
      const thread = (await rest.post(Routes.threads(config.parentChannelId), {
        body: { name: ticketName(number), type: ChannelType.PrivateThread, invitable: false, auto_archive_duration: 10_080 },
        reason: `Ticket #${number}`,
      })) as { id: string };
      channelId = thread.id;
      await rest.put(Routes.threadMembers(channelId, owner.id));
    } else {
      const botId = await this.ownId();
      const channel = (await rest.post(Routes.guildChannels(guildId), {
        body: {
          name: ticketName(number),
          type: ChannelType.GuildText,
          parent_id: config.parentChannelId,
          permission_overwrites: [
            { id: guildId, type: OverwriteType.Role, deny: PermissionFlagsBits.ViewChannel.toString() },
            { id: owner.id, type: OverwriteType.Member, allow: MEMBER_ALLOW.toString() },
            { id: botId, type: OverwriteType.Member, allow: (MEMBER_ALLOW | PermissionFlagsBits.ManageChannels).toString() },
            ...support.map((id) => ({ id, type: OverwriteType.Role, allow: MEMBER_ALLOW.toString() })),
          ],
        },
        reason: `Ticket #${number}`,
      })) as { id: string };
      channelId = channel.id;
    }

    const ticket = await db.ticket.create({
      data: {
        guildId,
        number,
        channelId,
        ownerId: owner.id,
        panelId: input.panelId,
        categoryId: category?.id ?? null,
        categoryLabel: category?.label ?? null,
        answers: input.answers as Prisma.InputJsonValue,
      },
    });
    await this.services.redis.set(channelKey(channelId), ticket.id);

    const vars = { ...owner.vars, 'ticket.number': number, 'ticket.category': category?.label ?? '' };
    const rendered = toRestMessage(renderMessage(config.openMessage, vars));
    const pings = [`<@${owner.id}>`, ...(config.pingSupport ? support.map((id) => `<@&${id}>`) : [])].join(' ');
    const answers = input.answers.length > 0 ? [{ title: t('tickets.answers'), color: 0x5865f2, fields: input.answers.map((a) => ({ name: a.question, value: a.answer.slice(0, 1024) || '—' })) }] : [];
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        content: [pings, rendered.content].filter(Boolean).join('\n').slice(0, 2000),
        embeds: [...(rendered.embeds ?? []), ...answers].slice(0, 10),
        allowed_mentions: { users: [owner.id], roles: config.pingSupport ? support : [] },
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              { type: ComponentType.Button, style: ButtonStyle.Danger, label: t('tickets.buttons.close'), custom_id: `${PREFIX}:close:${ticket.id}` },
              ...(config.claimEnabled ? [{ type: ComponentType.Button, style: ButtonStyle.Secondary, label: t('tickets.buttons.claim'), custom_id: `${PREFIX}:claim:${ticket.id}` }] : []),
            ],
          },
        ],
      },
    });

    await this.log(config, { content: t('tickets.log.opened', { number, user: `<@${owner.id}>`, channel: `<#${channelId}>`, category: category?.label ?? '—' }) });
    return ticket;
  }

  /** A support member takes the ticket; returns false when someone has it already. */
  async claim(ticket: Ticket, userId: string): Promise<boolean> {
    const { count } = await this.services.db.ticket.updateMany({ where: { id: ticket.id, claimedBy: null, status: 'open' }, data: { claimedBy: userId } });
    if (count === 0) return false;
    const t = await this.translator(ticket.guildId);
    await this.services.rest.post(Routes.channelMessages(ticket.channelId), { body: { content: t('tickets.claimed', { user: `<@${userId}>` }), allowed_mentions: { parse: [] } } });
    return true;
  }

  async transcript(ticket: Ticket, guildName: string): Promise<string> {
    const messages: APIMessage[] = [];
    let before: string | undefined;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ limit: '100', ...(before ? { before } : {}) });
      const answer: unknown = await this.services.rest.get(Routes.channelMessages(ticket.channelId), { query }).catch(() => []);
      const batch = Array.isArray(answer) ? (answer as APIMessage[]) : [];
      messages.push(...batch);
      if (batch.length < 100) break;
      before = batch.at(-1)!.id;
    }
    const header = [`${ticketName(ticket.number)} · ${guildName}`, `owner: ${ticket.ownerId}`, `opened: ${ticket.createdAt.toISOString()}`];
    return formatTranscript(header, messages.filter((m) => !m.author.bot || m.content || m.embeds.length > 0).reverse());
  }

  /** Closes the ticket: transcript to the log (and the member), the thread locked or the channel deleted. */
  async close(ticket: Ticket, config: TicketsConfig, { by, reason }: { by: string; reason: string | null }): Promise<Ticket> {
    const { db } = this.services;
    // Two closes at once (a double click, the button and auto-close) would both send the transcript: the one that moves
    // the ticket out of `open` goes on. Should closing fail, the ticket opens again so it can be closed once more.
    const claimed = await db.ticket.updateMany({ where: { id: ticket.id, status: 'open' }, data: { status: 'closed', closedAt: new Date(), closedBy: by, closeReason: reason } });
    if (claimed.count === 0) return (await db.ticket.findUnique({ where: { id: ticket.id } })) ?? ticket;
    try {
      await this.finishClose(ticket, config, { by, reason });
    } catch (err) {
      await db.ticket.update({ where: { id: ticket.id }, data: { status: 'open', closedAt: null, closedBy: null, closeReason: null } });
      throw err;
    }
    return db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  }

  private async finishClose(ticket: Ticket, config: TicketsConfig, { by, reason }: { by: string; reason: string | null }): Promise<void> {
    const { rest, redis, logger } = this.services;
    const t = await this.translator(ticket.guildId);
    const guild = (await rest.get(Routes.guild(ticket.guildId)).catch(() => ({ name: ticket.guildId }))) as { name: string };
    const transcript = await this.transcript(ticket, guild.name);
    const file = { name: `${ticketName(ticket.number)}.txt`, data: Buffer.from(transcript, 'utf8') };
    const closer = by === 'system' ? t('tickets.system') : `<@${by}>`;

    await this.log(
      config,
      {
        content: t('tickets.log.closed', { number: ticket.number, user: `<@${ticket.ownerId}>`, by: closer, reason: reason ?? '—' }),
      },
      file,
    );
    if (config.transcriptDm) {
      try {
        const dm = (await rest.post(Routes.userChannels(), { body: { recipient_id: ticket.ownerId } })) as { id: string };
        await rest.post(Routes.channelMessages(dm.id), { body: { content: t('tickets.dm', { number: ticket.number, guild: guild.name }) }, files: [file] });
      } catch (err) {
        logger.debug({ err, ticketId: ticket.id }, 'Ticket transcript DM not delivered');
      }
    }

    try {
      if (config.mode === 'thread' || (await this.isThread(ticket.channelId))) {
        await rest.post(Routes.channelMessages(ticket.channelId), { body: { content: t('tickets.closedNotice', { by: closer, reason: reason ?? '—' }), allowed_mentions: { parse: [] } } });
        await rest.patch(Routes.channel(ticket.channelId), { body: { archived: true, locked: true }, reason: `Ticket #${ticket.number} closed` });
      } else {
        await rest.delete(Routes.channel(ticket.channelId), { reason: `Ticket #${ticket.number} closed` });
      }
    } catch (err) {
      if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownChannel)) throw err;
    }

    await redis.del(channelKey(ticket.channelId));
  }

  /** Adds or removes a member: a thread member, or the member's overwrite on the channel. */
  async setAccess(ticket: Ticket, userId: string, allowed: boolean): Promise<void> {
    const { rest } = this.services;
    if (await this.isThread(ticket.channelId)) {
      await (allowed ? rest.put(Routes.threadMembers(ticket.channelId, userId)) : rest.delete(Routes.threadMembers(ticket.channelId, userId)));
      return;
    }
    if (allowed) await rest.put(Routes.channelPermission(ticket.channelId, userId), { body: { type: OverwriteType.Member, allow: MEMBER_ALLOW.toString() } });
    else await rest.delete(Routes.channelPermission(ticket.channelId, userId));
  }

  private async isThread(channelId: string): Promise<boolean> {
    const channel = (await this.services.rest.get(Routes.channel(channelId))) as { type: number };
    return channel.type === ChannelType.PrivateThread || channel.type === ChannelType.PublicThread;
  }

  private async log(config: TicketsConfig, body: { content: string }, file?: { name: string; data: Buffer }): Promise<void> {
    if (!config.logChannelId) return;
    await this.services.rest
      .post(Routes.channelMessages(config.logChannelId), { body: { ...body, allowed_mentions: { parse: [] } }, ...(file ? { files: [file] } : {}) })
      .catch((err: unknown) => this.services.logger.warn({ err }, 'Ticket log not delivered'));
  }

  private ownId(): Promise<string> {
    this.botId ??= (this.services.rest.get(Routes.user()) as Promise<APIUser>).then((u) => u.id);
    return this.botId;
  }
}
