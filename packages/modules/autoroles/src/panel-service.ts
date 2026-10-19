import { HttpError } from '@bot/core';
import type { Prisma, PrismaClient, RolePanel } from '@bot/db';
import { DiscordAPIError, RESTJSONErrorCodes, Routes, type REST } from 'discord.js';
import type { Panel, PanelInput } from './config.js';
import { panelMessageBody, toPanel } from './panel.js';

const data = (input: PanelInput) => ({
  channelId: input.channelId,
  kind: input.kind,
  mode: input.mode,
  maxRoles: input.maxRoles,
  message: input.message as Prisma.InputJsonValue,
  items: input.items as Prisma.InputJsonValue,
});

/** Role panels: storage and publishing to Discord via REST. Shared by the API and slash commands. */
export class PanelService {
  constructor(
    private readonly db: PrismaClient,
    private readonly rest: REST,
  ) {}

  async list(guildId: string): Promise<Panel[]> {
    return (await this.db.rolePanel.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } })).map(toPanel);
  }

  async find(guildId: string, panelId: string): Promise<RolePanel> {
    const row = await this.db.rolePanel.findUnique({ where: { id: panelId } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Role panel not found');
    return row;
  }

  async create(guildId: string, input: PanelInput): Promise<Panel> {
    return toPanel(await this.db.rolePanel.create({ data: { guildId, ...data(input) } }));
  }

  /** The channel changed — the old message is deleted and publishing posts the panel to the new one. */
  async update(guildId: string, panelId: string, input: PanelInput): Promise<Panel> {
    const row = await this.find(guildId, panelId);
    const moved = row.messageId !== null && row.channelId !== input.channelId;
    if (moved) await this.deleteMessage(row);
    return toPanel(await this.db.rolePanel.update({ where: { id: row.id }, data: { ...data(input), ...(moved ? { messageId: null } : {}) } }));
  }

  async delete(guildId: string, panelId: string): Promise<void> {
    const row = await this.find(guildId, panelId);
    await this.deleteMessage(row);
    await this.db.rolePanel.delete({ where: { id: row.id } });
  }

  /** Posts the panel message or updates the one already posted. */
  async publish(guildId: string, panelId: string): Promise<Panel> {
    const row = await this.find(guildId, panelId);
    const body = panelMessageBody(toPanel(row));

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
    return toPanel(await this.db.rolePanel.update({ where: { id: row.id }, data: { messageId } }));
  }

  private async deleteMessage(row: RolePanel): Promise<void> {
    if (!row.messageId) return;
    await this.rest.delete(Routes.channelMessage(row.channelId, row.messageId)).catch(() => undefined);
  }
}
