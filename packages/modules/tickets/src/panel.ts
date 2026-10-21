import { randomBytes } from 'node:crypto';
import { MessageTemplate } from '@bot/contracts';
import { HttpError } from '@bot/core';
import type { Prisma, PrismaClient, TicketPanel as TicketPanelRow } from '@bot/db';
import { BUTTON_STYLES, parseEmoji } from '@bot/discord';
import { renderMessage, toRestMessage } from '@bot/templates';
import { ComponentType, DiscordAPIError, RESTJSONErrorCodes, Routes, type APIActionRowComponent, type APIComponentInMessageActionRow, type REST } from 'discord.js';
import { z } from 'zod';
import { MAX_PANELS, TicketCategory, type TicketCategoryInput, type TicketPanel, type TicketPanelInput } from './config.js';

/** customId prefix of the module's components: `tk:open:<panelId>[:<categoryId>]`, `tk:close:<ticketId>`… */
export const PREFIX = 'tk';

const newId = () => randomBytes(6).toString('base64url');

/** Keeps the ids of categories and questions across edits (posted buttons keep working) and gives new ones theirs. */
export function withIds(categories: readonly TicketCategoryInput[]): TicketCategory[] {
  const fresh = (taken: Set<string>) => {
    let id = newId();
    while (taken.has(id)) id = newId();
    taken.add(id);
    return id;
  };
  const categoryIds = new Set(categories.flatMap((c) => (c.id ? [c.id] : [])));
  return categories.map((category) => {
    const questionIds = new Set(category.questions.flatMap((q) => (q.id ? [q.id] : [])));
    return {
      ...category,
      id: category.id ?? fresh(categoryIds),
      questions: category.questions.map((q) => ({ ...q, id: q.id ?? fresh(questionIds) })),
    };
  });
}

export function toPanel(row: TicketPanelRow): TicketPanel {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    messageId: row.messageId,
    kind: row.kind as TicketPanel['kind'],
    message: MessageTemplate.parse(row.message),
    categories: z.array(TicketCategory).parse(row.categories),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function buildComponents(panel: Pick<TicketPanel, 'id' | 'kind' | 'categories'>): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  if (panel.kind === 'select') {
    return [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: `${PREFIX}:open:${panel.id}`,
            min_values: 1,
            max_values: 1,
            options: panel.categories.map((c) => ({ label: c.label, value: c.id, description: c.description, emoji: parseEmoji(c.emoji) })),
          },
        ],
      },
    ];
  }
  const rows: APIActionRowComponent<APIComponentInMessageActionRow>[] = [];
  for (let i = 0; i < panel.categories.length; i += 5) {
    rows.push({
      type: ComponentType.ActionRow,
      components: panel.categories.slice(i, i + 5).map((c) => ({
        type: ComponentType.Button,
        style: BUTTON_STYLES[c.style],
        label: c.label,
        emoji: parseEmoji(c.emoji),
        custom_id: `${PREFIX}:open:${panel.id}:${c.id}`,
      })),
    });
  }
  return rows;
}

const data = (input: TicketPanelInput) => ({
  channelId: input.channelId,
  kind: input.kind,
  message: input.message as Prisma.InputJsonValue,
  categories: withIds(input.categories) as Prisma.InputJsonValue,
});

/** Ticket panels: storage and publishing via REST. */
export class PanelService {
  constructor(
    private readonly db: PrismaClient,
    private readonly rest: REST,
  ) {}

  async list(guildId: string): Promise<TicketPanel[]> {
    return (await this.db.ticketPanel.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } })).map(toPanel);
  }

  async find(guildId: string, panelId: string): Promise<TicketPanelRow> {
    const row = await this.db.ticketPanel.findUnique({ where: { id: panelId } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Ticket panel not found');
    return row;
  }

  async create(guildId: string, input: TicketPanelInput): Promise<TicketPanel> {
    if ((await this.db.ticketPanel.count({ where: { guildId } })) >= MAX_PANELS) throw HttpError.badRequest(`A server can have at most ${MAX_PANELS} ticket panels`);
    return toPanel(await this.db.ticketPanel.create({ data: { guildId, ...data(input) } }));
  }

  async update(guildId: string, panelId: string, input: TicketPanelInput): Promise<TicketPanel> {
    const row = await this.find(guildId, panelId);
    const moved = row.messageId !== null && row.channelId !== input.channelId;
    if (moved) await this.deleteMessage(row);
    return toPanel(await this.db.ticketPanel.update({ where: { id: row.id }, data: { ...data(input), ...(moved ? { messageId: null } : {}) } }));
  }

  async delete(guildId: string, panelId: string): Promise<void> {
    const row = await this.find(guildId, panelId);
    await this.deleteMessage(row);
    await this.db.ticketPanel.delete({ where: { id: row.id } });
  }

  async publish(guildId: string, panelId: string): Promise<TicketPanel> {
    const row = await this.find(guildId, panelId);
    const panel = toPanel(row);
    const body = { ...toRestMessage(renderMessage(panel.message, {})), components: buildComponents(panel) };
    let messageId = row.messageId;
    if (messageId) {
      try {
        await this.rest.patch(Routes.channelMessage(row.channelId, messageId), { body });
      } catch (err) {
        if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage)) throw err;
        messageId = null;
      }
    }
    messageId ??= ((await this.rest.post(Routes.channelMessages(row.channelId), { body })) as { id: string }).id;
    return toPanel(await this.db.ticketPanel.update({ where: { id: row.id }, data: { messageId } }));
  }

  private async deleteMessage(row: TicketPanelRow): Promise<void> {
    if (row.messageId) await this.rest.delete(Routes.channelMessage(row.channelId, row.messageId)).catch(() => undefined);
  }
}
