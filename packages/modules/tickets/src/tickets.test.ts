import { I18n } from '@bot/i18n';
import { describe, expect, it, vi } from 'vitest';
import { defaultTicketsConfig } from './config.js';
import { buildComponents, withIds } from './panel.js';
import { locales } from './locales.js';
import { formatTranscript, supportRolesOf, ticketName, TicketService } from './service.js';

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

  it('opens a forum ticket as a post with its first message and the open tag, then adds the buttons', async () => {
    const i18n = new I18n('ru');
    i18n.register('tickets', locales);
    const rest = {
      get: vi.fn(async () => ({ type: 15, available_tags: [{ id: 't-open', name: 'Открыт' }] })),
      post: vi.fn(async () => ({ id: 'post-1' })),
      put: vi.fn(async () => undefined),
      patch: vi.fn(async () => undefined),
    };
    const service = new TicketService({
      db: { ticketCounter: { upsert: async () => ({ last: 7 }) }, ticket: { create: async ({ data }: { data: object }) => ({ id: 'tk1', ...data }) } },
      rest,
      redis: { set: async () => 'OK' },
      logger: { warn: () => undefined },
      i18n,
      guildLocales: { get: async () => 'ru' },
    } as never);

    const ticket = await service.open({
      guildId: 'g',
      owner: { id: 'u', vars: {} },
      config: { ...defaultTicketsConfig, mode: 'forum', parentChannelId: 'forum' },
      panelId: null,
      category: null,
      answers: [],
    });

    expect(ticket.channelId).toBe('post-1');
    expect(rest.post).toHaveBeenCalledWith('/channels/forum/threads', expect.objectContaining({
      body: expect.objectContaining({ name: 'ticket-0007', applied_tags: ['t-open'], message: expect.objectContaining({ content: expect.stringContaining('<@u>') }) }),
    }));
    expect(rest.patch).toHaveBeenCalledWith('/channels/post-1/messages/post-1', { body: { components: [expect.objectContaining({ components: expect.arrayContaining([expect.objectContaining({ custom_id: 'tk:close:tk1' })]) })] } });
  });
});
