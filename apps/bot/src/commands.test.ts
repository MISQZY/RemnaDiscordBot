import { ModuleRegistry } from '@bot/core';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import type { REST } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { collectCommandPayloads, sameCommand, syncCommands } from './commands.js';

const logger = createLogger({ service: 'test', level: 'silent', pretty: false });
const APP = '100';
const GUILD = '200';

describe('collectCommandPayloads', () => {
  it('serializes commands of all registered modules', () => {
    const payloads = collectCommandPayloads(new ModuleRegistry(modules));

    expect(payloads.map((p) => p.name)).toEqual(expect.arrayContaining(['ping', 'help', 'modules', 'ban', 'rank', 'welcome']));
    expect(new Set(payloads.map((p) => p.name)).size).toBe(payloads.length);
    expect(payloads.find((p) => p.name === 'ping')).toMatchObject({
      description: 'Check bot latency',
      description_localizations: { ru: 'Проверить задержку бота' },
    });
  });
});

describe('sameCommand', () => {
  it('ignores fields Discord adds and empty defaults', () => {
    const desired = { name: 'ping', description: 'Ping', options: [], contexts: [0] };
    const existing = { id: '1', version: '9', type: 1, name: 'ping', description: 'Ping', nsfw: false, contexts: [0], description_localizations: null };
    expect(sameCommand(existing as never, desired as never)).toBe(true);
    expect(sameCommand({ ...existing, description: 'Pong' } as never, desired as never)).toBe(false);
  });
});

/** In-memory Discord REST: stores commands by route. */
function fakeDiscord(initial: { global?: object[]; guild?: object[] } = {}) {
  const store = new Map<string, { id: string; name: string }[]>([
    [`/applications/${APP}/commands`, (initial.global ?? []) as never],
    [`/applications/${APP}/guilds/${GUILD}/commands`, (initial.guild ?? []) as never],
  ]);
  const writes: string[] = [];
  let id = 0;
  const rest = {
    get: async (route: string) => store.get(route) ?? [],
    put: async (route: string, { body }: { body: { name: string }[] }) => {
      writes.push(`put ${route} ${body.length}`);
      store.set(route, body.map((c) => ({ ...c, id: String(++id) })));
    },
    post: async (route: string, { body }: { body: { name: string } }) => {
      writes.push(`post ${body.name}`);
      store.get(route)!.push({ ...body, id: String(++id) });
    },
    patch: async (route: string) => void writes.push(`patch ${route}`),
  };
  return { rest: rest as unknown as REST, writes, store };
}

const ping = { name: 'ping', description: 'Ping' } as never;
const help = { name: 'help', description: 'Help' } as never;

describe('syncCommands', () => {
  it('does nothing when global commands are up to date', async () => {
    const { rest, writes } = fakeDiscord({ global: [{ id: '1', name: 'ping', description: 'Ping' }] });
    expect(await syncCommands(rest, [ping], { applicationId: APP, logger })).toMatchObject({ created: [], updated: [] });
    expect(writes).toEqual([]);
  });

  it('bulk-overwrites global commands when anything differs', async () => {
    const { rest, writes } = fakeDiscord({ global: [{ id: '1', name: 'ping', description: 'Old' }] });
    expect(await syncCommands(rest, [ping, help], { applicationId: APP, logger })).toMatchObject({ created: ['help'], updated: ['ping'] });
    expect(writes).toEqual([`put /applications/${APP}/commands 2`]);
  });

  it('upserts guild commands one by one, keeps custom ones and clears global duplicates', async () => {
    const { rest, writes, store } = fakeDiscord({
      global: [{ id: '1', name: 'ping', description: 'Ping' }],
      guild: [
        { id: '2', name: 'ping', description: 'Old' },
        { id: '3', name: 'rules', description: 'Custom command' },
      ],
    });

    const result = await syncCommands(rest, [ping, help], { applicationId: APP, guildId: GUILD, logger });

    expect(result).toEqual({ scope: 'guild', created: ['help'], updated: ['ping'], clearedGlobal: true });
    expect(writes).toEqual([`patch /applications/${APP}/guilds/${GUILD}/commands/2`, 'post help', `put /applications/${APP}/commands 0`]);
    expect(store.get(`/applications/${APP}/guilds/${GUILD}/commands`)!.map((c) => c.name)).toContain('rules');
  });
});
