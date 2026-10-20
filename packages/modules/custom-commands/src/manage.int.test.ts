import type { InteractionContext } from '@bot/core';
import { createLogger } from '@bot/logger';
import { createTestDatabase, createTestRedis, type TestDatabase } from '@bot/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CustomCommandsConfig } from './config.js';
import { cc, responseModalHandler } from './manage.js';

const GUILD = '100000000000000001';
const USER = '200000000000000002';

describe('/cc', () => {
  let database: TestDatabase;
  let ctx: InteractionContext<CustomCommandsConfig>;
  const guild = { id: GUILD, channels: { cache: new Map() }, roles: { cache: new Map() } };

  beforeAll(async () => {
    database = await createTestDatabase();
    ctx = {
      db: database.db,
      redis: createTestRedis(),
      rest: {},
      logger: createLogger({ service: 'test', level: 'silent', pretty: false }),
      t: (key: string) => key,
    } as unknown as InteractionContext<CustomCommandsConfig>;
  });

  afterAll(async () => {
    await database.cleanup();
  });

  const slash = (sub: string, strings: Record<string, string>, booleans: Record<string, boolean> = {}) => ({
    id: '900000000000000009',
    guild,
    guildId: GUILD,
    user: { id: USER },
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => strings[name] ?? null,
      getBoolean: (name: string) => booleans[name] ?? null,
    },
    showModal: vi.fn(async () => {}),
    reply: vi.fn(async () => {}),
  });

  const modal = (customId: string, response: string, extra?: string) => ({
    customId,
    guild,
    guildId: GUILD,
    user: { id: USER },
    memberPermissions: { has: () => true },
    isModalSubmit: () => true,
    fields: {
      fields: new Map(extra === undefined ? [] : [['extra', {}]]),
      getTextInputValue: (id: string) => (id === 'response' ? response : extra!),
    },
    reply: vi.fn(async () => {}),
  });

  it('creates an auto-reply through the response modal', async () => {
    const add = slash('add', { type: 'trigger', name: 'rules', match: 'contains', pattern: 'правила' });
    await cc.execute(add as never, ctx);
    expect(add.showModal).toHaveBeenCalledOnce();

    const submit = modal('cc:add:900000000000000009', 'Правила — в #rules');
    await responseModalHandler.handle(submit as never, ctx);

    expect(submit.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'custom-commands.manage.created' }));
    const row = await database.db.customCommand.findFirstOrThrow({ where: { guildId: GUILD, name: 'rules' } });
    expect(row).toMatchObject({ kind: 'trigger', matchMode: 'contains', pattern: 'правила', createdBy: USER });
    expect(row.response).toEqual({ content: 'Правила — в #rules' });

    // The pending form is single-use.
    const again = modal('cc:add:900000000000000009', 'x');
    await responseModalHandler.handle(again as never, ctx);
    expect(again.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'custom-commands.manage.expired' }));
  });

  it('rejects invalid slash names before asking for the response', async () => {
    const add = slash('add', { type: 'slash', name: 'Bad Name' });
    await cc.execute(add as never, ctx);
    expect(add.showModal).not.toHaveBeenCalled();
    expect(add.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'custom-commands.manage.errors.invalid' }));
  });

  it('edits the response and the pattern, then deletes the command', async () => {
    const row = await database.db.customCommand.findFirstOrThrow({ where: { guildId: GUILD, name: 'rules' } });
    const submit = modal(`cc:edit:${row.id}`, 'Новые правила', 'регламент');
    await responseModalHandler.handle(submit as never, ctx);
    expect(await database.db.customCommand.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      pattern: 'регламент',
      response: { content: 'Новые правила' },
    });

    const remove = slash('delete', { command: row.id });
    await cc.execute(remove as never, ctx);
    expect(remove.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'custom-commands.manage.deleted' }));
    expect(await database.db.customCommand.count({ where: { guildId: GUILD } })).toBe(0);
  });
});
