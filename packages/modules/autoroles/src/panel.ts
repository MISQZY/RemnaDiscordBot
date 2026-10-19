import { MessageTemplate } from '@bot/contracts';
import type { RolePanel } from '@bot/db';
import { renderMessage, toRestMessage } from '@bot/templates';
import { ButtonStyle, ComponentType } from 'discord.js';
import type { APIActionRowComponent, APIComponentInMessageActionRow, APIMessageComponentEmoji } from 'discord.js';
import { z } from 'zod';
import { PanelItem, type Panel } from './config.js';

/** Префикс customId компонентов модуля: `ar:<panelId>[:<roleId>]`. */
export const COMPONENT_PREFIX = 'ar';

export function toPanel(row: RolePanel): Panel {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    messageId: row.messageId,
    kind: row.kind as Panel['kind'],
    mode: row.mode as Panel['mode'],
    maxRoles: row.maxRoles,
    message: MessageTemplate.parse(row.message),
    items: z.array(PanelItem).parse(row.items),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface RoleChanges {
  add: string[];
  remove: string[];
  /** Выбор превышает `maxRoles` — ничего не меняем. */
  limited: boolean;
}

/**
 * Какие роли выдать и снять по нажатию кнопки (`picked` — одна роль) или выбору в списке
 * (`picked` — итоговый выбор). Учитываются только роли этой панели.
 */
export function computeRoleChanges(
  panel: Pick<Panel, 'mode' | 'maxRoles' | 'items'>,
  memberRoleIds: ReadonlySet<string>,
  picked: readonly string[],
  source: 'button' | 'select',
): RoleChanges {
  const panelRoles = new Set(panel.items.map((item) => item.roleId));
  const valid = picked.filter((id) => panelRoles.has(id));
  const current = [...panelRoles].filter((id) => memberRoleIds.has(id));
  const has = (id: string) => memberRoleIds.has(id);
  const none: RoleChanges = { add: [], remove: [], limited: false };

  if (source === 'select') {
    if (panel.mode === 'add') return { ...none, add: valid.filter((id) => !has(id)) };
    if (panel.mode === 'remove') return { ...none, remove: valid.filter(has) };
    const desired = panel.mode === 'unique' ? valid.slice(0, 1) : valid;
    if (panel.maxRoles && desired.length > panel.maxRoles) return { ...none, limited: true };
    return { add: desired.filter((id) => !has(id)), remove: current.filter((id) => !desired.includes(id)), limited: false };
  }

  const [roleId] = valid;
  if (!roleId) return none;
  switch (panel.mode) {
    case 'add':
      return has(roleId) ? none : { ...none, add: [roleId] };
    case 'remove':
      return has(roleId) ? { ...none, remove: [roleId] } : none;
    case 'unique':
      return has(roleId) ? { ...none, remove: [roleId] } : { add: [roleId], remove: current, limited: false };
    case 'toggle':
      if (has(roleId)) return { ...none, remove: [roleId] };
      if (panel.maxRoles && current.length >= panel.maxRoles) return { ...none, limited: true };
      return { ...none, add: [roleId] };
  }
}

const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
} as const;

export function parseEmoji(emoji: string | undefined): APIMessageComponentEmoji | undefined {
  if (!emoji) return undefined;
  const custom = /^<(a?):(\w+):(\d+)>$/.exec(emoji);
  return custom ? { id: custom[3], name: custom[2], animated: custom[1] === 'a' } : { name: emoji };
}

/** Компоненты сообщения панели в формате Discord API. */
export function buildComponents(panel: Pick<Panel, 'id' | 'kind' | 'mode' | 'maxRoles' | 'items'>): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  if (panel.kind === 'select') {
    const max = panel.mode === 'unique' ? 1 : Math.min(panel.maxRoles ?? panel.items.length, panel.items.length);
    return [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: `${COMPONENT_PREFIX}:${panel.id}`,
            min_values: 0,
            max_values: max,
            options: panel.items.map((item) => ({
              label: item.label,
              value: item.roleId,
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
        custom_id: `${COMPONENT_PREFIX}:${panel.id}:${item.roleId}`,
      })),
    });
  }
  return rows;
}

/** Тело сообщения панели для Discord REST. */
export function panelMessageBody(panel: Panel) {
  return { ...toRestMessage(renderMessage(panel.message, {})), components: buildComponents(panel) };
}
