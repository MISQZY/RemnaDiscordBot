import { createHash } from 'node:crypto';
import { HttpError } from '@bot/core';
import { API_LIMITS, storedSettings, type ApiSettings } from './api-settings.js';
import { SourceFailure, type FeedItem, type FeedResult, type Provider } from './providers.js';
import { createSafeFetch, FetchRefused, type FetchText } from './safe-fetch.js';
import { payloadVars } from './webhook.js';

// Any JSON API polled like a feed: a GET with the subscriber's headers (an API key, say), the list of items found by
// a path in the answer, each told apart by a field. The settings may hold secrets, so every such source belongs to
// one subscription and is never shared; header values are not given back by the API.

function at(node: unknown, path: string): unknown {
  if (!path) return node;
  let current = node;
  for (const key of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(key)) current = current[Number(key)];
    else if (current !== null && typeof current === 'object' && Object.hasOwn(current, key)) current = (current as Record<string, unknown>)[key];
    else return undefined;
  }
  return current;
}

/**
 * The items of an answer, newest first: the array at `itemsPath` (an object there is one item, for "the latest X"
 * endpoints). Each item's fields are `{item.…}` placeholders; its ID is the `idField`, else a hash of the item.
 */
export function extractItems(json: unknown, settings: Pick<ApiSettings, 'itemsPath' | 'idField' | 'oldestFirst'>): FeedItem[] {
  const node = at(json, settings.itemsPath);
  if (node === null || typeof node !== 'object') throw new Error(`No list or object at "${settings.itemsPath || '(the answer)'}"`);
  const list = Array.isArray(node) ? node : [node];
  const ordered = settings.oldestFirst ? [...list].reverse() : list;
  return ordered.slice(0, API_LIMITS.items).map((item) => {
    const id = at(item, settings.idField);
    const { vars, text } = payloadVars(item, 'item');
    return {
      id: typeof id === 'string' || typeof id === 'number' ? String(id) : createHash('sha1').update(JSON.stringify(item) ?? '').digest('hex'),
      vars,
      text,
    };
  });
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ApiProvider implements Provider {
  readonly id = 'api' as const;
  readonly vipFeature = 'notificationsApi' as const;

  constructor(private readonly fetchText: FetchText = createSafeFetch({ timeoutMs: 10_000 })) {}

  /** API sources are made from their settings (see `check`), not looked up by a name. */
  lookup(): never {
    throw HttpError.badRequest('An API source is set up with its settings');
  }

  /** Requests the API once, as a subscription is made or changed: what is wrong is told right away. */
  async check(settings: ApiSettings): Promise<FeedItem[]> {
    const result = await this.items(settings);
    if (result instanceof SourceFailure) throw HttpError.badRequest(`The API check failed: ${result.message}`, [{ path: ['api', 'url'], message: result.message }]);
    return result;
  }

  async latest(externalIds: string[], settings: Map<string, unknown> = new Map()): Promise<Map<string, FeedResult>> {
    const result = new Map<string, FeedResult>();
    // Each source is a single subscription's: few of them, so one after another.
    for (const id of externalIds) {
      const parsed = storedSettings(settings.get(id));
      result.set(id, parsed ? await this.items(parsed) : new SourceFailure('invalid', 'The source has no valid settings'));
    }
    return result;
  }

  private async items(settings: ApiSettings): Promise<FeedResult> {
    let response;
    try {
      response = await this.fetchText(settings.url, { accept: 'application/json', ...Object.fromEntries(settings.headers.map((h) => [h.name, h.value])) });
    } catch (err) {
      return new SourceFailure(err instanceof FetchRefused ? 'invalid' : 'unavailable', message(err));
    }
    const failed = (kind: ConstructorParameters<typeof SourceFailure>[0]) => new SourceFailure(kind, `The API responded with ${response.status}`);
    if (response.status === 401 || response.status === 403) return failed('denied');
    if (response.status === 404 || response.status === 410) return failed('notFound');
    if (response.status < 200 || response.status >= 300) return failed('unavailable');
    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      return new SourceFailure('invalid', 'The answer is not JSON');
    }
    try {
      return extractItems(json, settings);
    } catch (err) {
      return new SourceFailure('invalid', message(err));
    }
  }
}
