import { describe, expect, it, vi } from 'vitest';
import { ApiSettings, ApiSettingsInput, mergeSettings, toSettingsDto } from './api-settings.js';
import { ApiProvider, extractItems } from './api-source.js';
import { SourceFailure } from './providers.js';
import type { FetchedText, FetchText } from './safe-fetch.js';

const settings = (over: Partial<ApiSettings> = {}): ApiSettings => ApiSettings.parse({ url: 'https://api.example/items', ...over });

describe('extractItems', () => {
  const answer = {
    data: {
      results: [
        { id: 2, title: 'Second', tags: ['x'] },
        { id: 1, title: 'First' },
      ],
    },
  };

  it('takes the list at the path, newest first, with fields as item placeholders', () => {
    const items = extractItems(answer, { itemsPath: 'data.results', idField: 'id', oldestFirst: false });
    expect(items.map((i) => i.id)).toEqual(['2', '1']);
    expect(items[0]!.vars).toEqual({ 'item.id': 2, 'item.title': 'Second', 'item.tags.count': 1, 'item.tags.items': 'x', 'item.tags.first': 'x' });
    expect(items[0]!.text).toContain('Second');
  });

  it('turns an oldest-first list around and reads nested IDs and indexes', () => {
    const items = extractItems({ list: [{ meta: { key: 'a' } }, { meta: { key: 'b' } }] }, { itemsPath: 'list', idField: 'meta.key', oldestFirst: true });
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(extractItems({ pages: [{ items: [{ id: 'z' }] }] }, { itemsPath: 'pages.0.items', idField: 'id', oldestFirst: false })[0]!.id).toBe('z');
  });

  it('takes an object as the one item of a "latest" endpoint, and hashes items without an ID', () => {
    expect(extractItems({ tag_name: 'v2', name: 'Release' }, { itemsPath: '', idField: 'tag_name', oldestFirst: false })[0]!.id).toBe('v2');
    const [a] = extractItems([{ title: 'No id' }], { itemsPath: '', idField: 'id', oldestFirst: false });
    expect(a!.id).toMatch(/^[\da-f]{40}$/);
  });

  it('fails when the path leads to no list or object', () => {
    expect(() => extractItems({ data: 'text' }, { itemsPath: 'data', idField: 'id', oldestFirst: false })).toThrow('No list or object at "data"');
    expect(() => extractItems({}, { itemsPath: 'missing', idField: 'id', oldestFirst: false })).toThrow();
  });
});

describe('ApiSettings', () => {
  it('accepts http(s) addresses and plain headers only', () => {
    expect(ApiSettings.safeParse({ url: 'ftp://api.example/' }).success).toBe(false);
    expect(ApiSettings.safeParse({ url: 'https://api.example/', headers: [{ name: 'Host', value: 'internal' }] }).success).toBe(false);
    expect(ApiSettings.safeParse({ url: 'https://api.example/', headers: [{ name: 'X-Key', value: 'a\r\nInjected: 1' }] }).success).toBe(false);
    expect(ApiSettings.safeParse({ url: 'https://api.example/', headers: [{ name: 'Authorization', value: 'Bearer t' }] }).success).toBe(true);
  });

  it('keeps stored header values the manager left empty, and needs the value of a new header', () => {
    const stored = settings({ headers: [{ name: 'Authorization', value: 'Bearer old' }] });
    const input = ApiSettingsInput.parse({ url: 'https://api.example/items', headers: [{ name: 'authorization', value: null }, { name: 'X-Extra', value: '1' }] });
    expect(mergeSettings(input, stored).headers).toEqual([
      { name: 'authorization', value: 'Bearer old' },
      { name: 'X-Extra', value: '1' },
    ]);
    expect(() => mergeSettings(ApiSettingsInput.parse({ url: 'https://api.example/', headers: [{ name: 'X-New', value: null }] }), stored)).toThrow('X-New');
  });

  it('shows settings without header values', () => {
    expect(toSettingsDto(settings({ headers: [{ name: 'Authorization', value: 'secret' }] }))).toEqual({
      url: 'https://api.example/items',
      itemsPath: '',
      idField: 'id',
      oldestFirst: false,
      headers: [{ name: 'Authorization' }],
    });
  });
});

const fetched = (body: string, status = 200): FetchedText => ({ url: 'https://api.example/items', status, headers: {}, body });

describe('ApiProvider', () => {
  it('sends the headers and reads the items', async () => {
    const fetchText = vi.fn<FetchText>(async () => fetched(JSON.stringify([{ id: 1 }])));
    const provider = new ApiProvider(fetchText);
    const result = await provider.latest(['s1'], new Map([['s1', settings({ headers: [{ name: 'Authorization', value: 'Bearer t' }] })]]));

    expect(result.get('s1')).toEqual([expect.objectContaining({ id: '1' })]);
    expect(fetchText).toHaveBeenCalledWith('https://api.example/items', { accept: 'application/json', Authorization: 'Bearer t' });
  });

  it('tells what went wrong with a source', async () => {
    const answers: Record<string, () => Promise<FetchedText>> = {
      denied: async () => fetched('', 401),
      gone: async () => fetched('', 404),
      down: async () => fetched('', 500),
      html: async () => fetched('<html>'),
      nopath: async () => fetched('{"a":1}'),
    };
    const provider = new ApiProvider((url) => answers[new URL(url).hostname]!());
    const ids = Object.keys(answers);
    const result = await provider.latest([...ids, 'broken'], new Map(ids.map((id) => [id, settings({ url: `https://${id}/`, itemsPath: 'items' })])));

    expect(Object.fromEntries([...result].map(([id, r]) => [id, r instanceof SourceFailure ? r.kind : 'ok']))).toEqual({
      denied: 'denied',
      gone: 'notFound',
      down: 'unavailable',
      html: 'invalid',
      nopath: 'invalid',
      broken: 'invalid',
    });
  });

  it('refuses settings that do not work when they are checked', async () => {
    const provider = new ApiProvider(async () => fetched('', 403));
    await expect(provider.check(settings())).rejects.toMatchObject({ statusCode: 400 });
  });
});
