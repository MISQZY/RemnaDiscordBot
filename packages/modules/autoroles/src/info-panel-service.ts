import { HttpError } from '@bot/core';
import type { InfoPanel as InfoPanelRow, Prisma, PrismaClient } from '@bot/db';
import { DiscordAPIError, RESTJSONErrorCodes, Routes, type REST } from 'discord.js';
import { MAX_INFO_PANELS, type InfoPanel, type InfoPanelInput } from './config.js';
import { infoPanelMessageBody, toInfoPanel, withItemIds } from './info-panel.js';

const data = (input: InfoPanelInput) => ({
  channelId: input.channelId,
  kind: input.kind,
  message: input.message as Prisma.InputJsonValue,
  items: withItemIds(input.items) as Prisma.InputJsonValue,
});

/** Info panels: storage and publishing to Discord via REST. */
export class InfoPanelService {
  constructor(
    private readonly db: PrismaClient,
    private readonly rest: REST,
  ) {}

  async list(guildId: string): Promise<InfoPanel[]> {
    return (await this.db.infoPanel.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } })).map(toInfoPanel);
  }

  async find(guildId: string, panelId: string): Promise<InfoPanelRow> {
    const row = await this.db.infoPanel.findUnique({ where: { id: panelId } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Info panel not found');
    return row;
  }

  async create(guildId: string, input: InfoPanelInput): Promise<InfoPanel> {
    if ((await this.db.infoPanel.count({ where: { guildId } })) >= MAX_INFO_PANELS) {
      throw HttpError.badRequest(`A server can have at most ${MAX_INFO_PANELS} info panels`);
    }
    return toInfoPanel(await this.db.infoPanel.create({ data: { guildId, ...data(input) } }));
  }

  /** The channel changed — the old message is deleted and publishing posts the panel to the new one. */
  async update(guildId: string, panelId: string, input: InfoPanelInput): Promise<InfoPanel> {
    const row = await this.find(guildId, panelId);
    const moved = row.messageId !== null && row.channelId !== input.channelId;
    if (moved) await this.deleteMessage(row);
    return toInfoPanel(await this.db.infoPanel.update({ where: { id: row.id }, data: { ...data(input), ...(moved ? { messageId: null } : {}) } }));
  }

  async delete(guildId: string, panelId: string): Promise<void> {
    const row = await this.find(guildId, panelId);
    await this.deleteMessage(row);
    await this.db.infoPanel.delete({ where: { id: row.id } });
  }

  /** Posts the panel message or updates the one already posted. */
  async publish(guildId: string, panelId: string): Promise<InfoPanel> {
    const row = await this.find(guildId, panelId);
    const body = infoPanelMessageBody(toInfoPanel(row));

    let messageId = row.messageId;
    if (messageId) {
      try {
        await this.rest.patch(Routes.channelMessage(row.channelId, messageId), { body });
      } catch (err) {
        // The message was deleted manually — post it again.
        if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage)) throw err;
        messageId = null;
      }
    }
    messageId ??= ((await this.rest.post(Routes.channelMessages(row.channelId), { body })) as { id: string }).id;
    return toInfoPanel(await this.db.infoPanel.update({ where: { id: row.id }, data: { messageId } }));
  }

  private async deleteMessage(row: InfoPanelRow): Promise<void> {
    if (!row.messageId) return;
    await this.rest.delete(Routes.channelMessage(row.channelId, row.messageId)).catch(() => undefined);
  }
}
