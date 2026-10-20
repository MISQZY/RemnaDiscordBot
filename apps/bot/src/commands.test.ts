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

  it('keeps every command within Discord size limits in each language', () => {
    interface Node {
      name: string;
      description?: string;
      name_localizations?: Record<string, string> | null;
      description_localizations?: Record<string, string> | null;
      options?: Node[];
      choices?: { name: string; value: string | number; name_localizations?: Record<string, string> | null }[];
    }
    // Discord caps the name, description and choice texts of a command with its options at 4000 characters.
    const size = (node: Node, locale: string): number =>
      (node.name_localizations?.[locale] ?? node.name).length +
      (node.description_localizations?.[locale] ?? node.description ?? '').length +
      (node.choices ?? []).reduce((sum, c) => sum + (c.name_localizations?.[locale] ?? c.name).length + String(c.value).length, 0) +
      (node.options ?? []).reduce((sum, o) => sum + size(o, locale), 0);
    const texts = (node: Node): string[] => [node.description ?? '', ...Object.values(node.description_localizations ?? {}), ...(node.options ?? []).flatMap(texts)];

    for (const payload of collectCommandPayloads(new ModuleRegistry(modules)) as unknown as Node[]) {
      for (const locale of ['en-US', 'ru']) expect(size(payload, locale), `/${payload.name} (${locale})`).toBeLessThanOrEqual(4000);
      for (const text of texts(payload)) expect(text.length, `/${payload.name}: ${text}`).toBeLessThanOrEqual(100);
      expect(payload.options?.length ?? 0, `/${payload.name}`).toBeLessThanOrEqual(25);
    }
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

/** Drops `*_localizations` at any depth — what Discord does without `with_localizations`. */
function withoutLocalizations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLocalizations);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.endsWith('_localizations')).map(([key, v]) => [key, withoutLocalizations(v)]));
}

/** In-memory Discord REST: stores commands by route and answers like Discord does. */
function fakeDiscord(initial: { global?: object[]; guild?: object[] } = {}) {
  const guildRoute = `/applications/${APP}/guilds/${GUILD}/commands`;
  const store = new Map<string, { id: string; name: string }[]>([
    [`/applications/${APP}/commands`, (initial.global ?? []) as never],
    [guildRoute, (initial.guild ?? []) as never],
  ]);
  const writes: string[] = [];
  let id = 0;
  // Discord does not keep `contexts` on guild commands.
  const stored = (route: string, command: object) => {
    const { contexts, ...rest } = command as { contexts?: unknown };
    return route === guildRoute ? rest : { ...rest, contexts };
  };
  const rest = {
    get: async (route: string, options?: { query?: URLSearchParams }) => {
      const commands = store.get(route) ?? [];
      return options?.query?.get('with_localizations') === 'true' ? commands : withoutLocalizations(commands);
    },
    put: async (route: string, { body }: { body: { name: string }[] }) => {
      writes.push(`put ${route} ${body.length}`);
      store.set(route, body.map((c) => ({ ...stored(route, c), id: String(++id) }) as never));
    },
    post: async (route: string, { body }: { body: { name: string } }) => {
      writes.push(`post ${body.name}`);
      store.get(route)!.push({ ...stored(route, body), id: String(++id) } as never);
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

  it.each([
    ['global', undefined],
    ['guild', GUILD],
  ])('changes nothing on a second sync of the real %s commands', async (_, guildId) => {
    const body = collectCommandPayloads(new ModuleRegistry(modules));
    const { rest, writes } = fakeDiscord();
    await syncCommands(rest, body, { applicationId: APP, guildId, logger });
    writes.length = 0;

    expect(await syncCommands(rest, body, { applicationId: APP, guildId, logger })).toMatchObject({ created: [], updated: [] });
    expect(writes).toEqual([]);
  });
});
