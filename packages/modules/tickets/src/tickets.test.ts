import { describe, expect, it } from 'vitest';
import { defaultTicketsConfig } from './config.js';
import { buildComponents, withIds } from './panel.js';
import { formatTranscript, supportRolesOf, ticketName } from './service.js';

describe('tickets', () => {
  it('gives new categories and questions ids and keeps the existing ones', () => {
    const [kept, fresh] = withIds([
      { id: 'pay', label: 'Pay', style: 'primary', questions: [{ id: 'q1', label: 'Order', required: true, long: false }, { label: 'More', required: false, long: true }], supportRoleIds: [] },
      { label: 'Other', style: 'secondary', questions: [], supportRoleIds: [] },
    ]);
    expect(kept!.id).toBe('pay');
    expect(kept!.questions.map((q) => q.id)).toEqual(['q1', expect.stringMatching(/^[\w-]+$/)]);
    expect(fresh!.id).toMatch(/^[\w-]+$/);
  });

  it('builds buttons and a menu that open the category', () => {
    const categories = [{ id: 'a', label: 'A', style: 'danger' as const, questions: [], supportRoleIds: [] }];
    expect(buildComponents({ id: 'p', kind: 'buttons', categories })[0]!.components[0]).toMatchObject({ custom_id: 'tk:open:p:a', style: 4 });
    expect(buildComponents({ id: 'p', kind: 'select', categories })[0]!.components[0]).toMatchObject({ custom_id: 'tk:open:p', options: [{ value: 'a' }] });
  });

  it('formats a transcript line per message with embeds and files', () => {
    const text = formatTranscript(['ticket-0001'], [
      { author: { username: 'ann' }, content: 'hello', timestamp: '2026-10-22T10:05:00.000Z', attachments: [{ url: 'https://cdn/x.png' }], embeds: [] },
      { author: { username: 'bot' }, content: '', timestamp: '2026-10-22T10:06:00.000Z', attachments: [], embeds: [{ title: 'Answers' }] },
    ] as never);
    expect(text).toBe('ticket-0001\n\n[2026-10-22 10:05] ann: hello\n    [file] https://cdn/x.png\n[2026-10-22 10:06] bot: [embed] Answers');
  });

  it('names tickets and picks support roles of the category first', () => {
    expect(ticketName(42)).toBe('ticket-0042');
    const config = { ...defaultTicketsConfig, supportRoleIds: ['all'] };
    expect(supportRolesOf(config, { supportRoleIds: ['billing'] })).toEqual(['billing']);
    expect(supportRolesOf(config, { supportRoleIds: [] })).toEqual(['all']);
  });
});
