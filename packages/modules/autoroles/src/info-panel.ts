import { randomBytes } from 'node:crypto';
import { MessageTemplate } from '@bot/contracts';
import type { InfoPanel as InfoPanelRow } from '@bot/db';
import { renderMessage, toRestMessage } from '@bot/templates';
import { ComponentType } from 'discord.js';
import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord.js';
import { z } from 'zod';
import { InfoPanelItem, type InfoPanel, type InfoPanelItemInput } from './config.js';
import { BUTTON_STYLES, parseEmoji } from './panel.js';

/** customId prefix of info panel components: `ip:<panelId>[:<itemId>]`. */
export const INFO_COMPONENT_PREFIX = 'ip';

export function toInfoPanel(row: InfoPanelRow): InfoPanel {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    messageId: row.messageId,
    kind: row.kind as InfoPanel['kind'],
    message: MessageTemplate.parse(row.message),
    items: z.array(InfoPanelItem).parse(row.items),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const newItemId = () => randomBytes(6).toString('base64url');

/** Items keep their ids; new ones get a fresh id. */
export function withItemIds(items: readonly InfoPanelItemInput[]): InfoPanelItem[] {
  const taken = new Set(items.flatMap((i) => (i.id ? [i.id] : [])));
  return items.map((item) => {
    if (item.id) return { ...item, id: item.id };
    let id = newItemId();
    while (taken.has(id)) id = newItemId();
    taken.add(id);
    return { ...item, id };
  });
}

/** Info panel message components in the Discord API format. */
export function buildInfoComponents(panel: Pick<InfoPanel, 'id' | 'kind' | 'items'>): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  if (panel.kind === 'select') {
    return [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: `${INFO_COMPONENT_PREFIX}:${panel.id}`,
            min_values: 1,
            max_values: 1,
            options: panel.items.map((item) => ({
              label: item.label,
              value: item.id,
              description: item.description,
              emoji: parseEmoji(item.emoji),
            })),
          },
        ],
      },
    ];
  }

  const rows: APIActionRowComponent<APIComponentInMessageActionRow>[] = [];
  for (let i = 0; i < panel.items.length; i += 5) {
    rows.push({
      type: ComponentType.ActionRow,
      components: panel.items.slice(i, i + 5).map((item) => ({
        type: ComponentType.Button,
        style: BUTTON_STYLES[item.style],
        label: item.label,
        emoji: parseEmoji(item.emoji),
        custom_id: `${INFO_COMPONENT_PREFIX}:${panel.id}:${item.id}`,
      })),
    });
  }
  return rows;
}

/** Info panel message body for Discord REST. */
export function infoPanelMessageBody(panel: InfoPanel) {
  return { ...toRestMessage(renderMessage(panel.message, {})), components: buildInfoComponents(panel) };
}
