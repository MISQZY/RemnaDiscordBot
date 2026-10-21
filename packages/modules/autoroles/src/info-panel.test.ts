import { ButtonStyle, ComponentType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { InfoPanelInput } from './config.js';
import { buildInfoComponents, withItemIds } from './info-panel.js';

const reply = { content: 'Hi' };

describe('withItemIds', () => {
  it('keeps given ids and assigns new unique ones', () => {
    const items = withItemIds([
      { id: 'rules', label: 'Rules', style: 'secondary', reply },
      { label: 'FAQ', style: 'primary', reply },
      { label: 'Links', style: 'primary', reply },
    ]);
    expect(items[0]!.id).toBe('rules');
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
    expect(items.every((i) => /^[\w-]{1,32}$/.test(i.id))).toBe(true);
  });
});

describe('InfoPanelInput', () => {
  it('takes back the ids the service gave', () => {
    const items = withItemIds([
      { label: 'A', style: 'secondary', reply },
      { id: 'rules_1-x', label: 'B', style: 'secondary', reply },
    ]);
    expect(InfoPanelInput.safeParse({ channelId: '123456789012345678', kind: 'buttons', message: reply, items }).success).toBe(true);
  });

  it('rejects repeated item ids', () => {
    const items = [
      { id: 'a', label: 'A', reply },
      { id: 'a', label: 'B', reply },
    ];
    expect(InfoPanelInput.safeParse({ channelId: '123456789012345678', kind: 'buttons', message: reply, items }).success).toBe(false);
  });

  it('requires a reply for every item', () => {
    const items = [{ label: 'A', reply: {} }];
    expect(InfoPanelInput.safeParse({ channelId: '123456789012345678', kind: 'buttons', message: reply, items }).success).toBe(false);
  });
});

describe('buildInfoComponents', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, label: `L${i}`, style: 'success' as const, reply }));

  it('puts buttons five a row with the item id in customId', () => {
    const rows = buildInfoComponents({ id: 'p1', kind: 'buttons', items });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.components[0]).toMatchObject({ type: ComponentType.Button, style: ButtonStyle.Success, custom_id: 'ip:p1:i0' });
  });

  it('builds a single-pick dropdown with item ids as values', () => {
    const [row] = buildInfoComponents({ id: 'p1', kind: 'select', items });
    expect(row!.components[0]).toMatchObject({ type: ComponentType.StringSelect, custom_id: 'ip:p1', min_values: 1, max_values: 1 });
    expect((row!.components[0] as { options: { value: string }[] }).options.map((o) => o.value)).toEqual(items.map((i) => i.id));
  });
});
