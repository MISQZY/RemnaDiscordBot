import { HttpError, type SecretBox } from '@bot/core';
import type { Prisma } from '@bot/db';
import { z } from 'zod';
import { secrets } from './secrets.js';

// Settings of an API source (see api-source.ts): what is stored, what a manager sends, what the API shows.

export const API_LIMITS = { url: 1000, headers: 5, headerName: 100, headerValue: 2000, path: 200, items: 100 } as const;

/** Headers the request sets itself, or that would change what the connection is. */
const RESERVED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'accept-encoding', 'upgrade', 'te', 'keep-alive', 'trailer']);

const HeaderName = z
  .string()
  .max(API_LIMITS.headerName)
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Not a header name')
  .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), 'This header is set by the bot');
const HeaderValue = z
  .string()
  .max(API_LIMITS.headerValue)
  .regex(/^[^\r\n]*$/, 'A header value is one line');

/** `data.items`, `results.0.entries`: object keys and array indexes by dots; empty — the answer itself. */
const Path = z
  .string()
  .trim()
  .max(API_LIMITS.path)
  .regex(/^(?:[^.\s]+(?:\.[^.\s]+)*)?$/, 'Keys separated by dots');

const Url = z.url({ protocol: /^https?$/ }).max(API_LIMITS.url);

/** What is stored on the source. */
export const ApiSettings = z.object({
  url: Url,
  headers: z.array(z.object({ name: HeaderName, value: HeaderValue })).max(API_LIMITS.headers).default([]),
  itemsPath: Path.default(''),
  idField: Path.default('id'),
  /** The API lists the oldest items first. */
  oldestFirst: z.boolean().default(false),
});
export type ApiSettings = z.infer<typeof ApiSettings>;

/** What a manager sends: a header's value `null` keeps the stored one (they are never shown). */
export const ApiSettingsInput = ApiSettings.extend({
  headers: z.array(z.object({ name: HeaderName, value: HeaderValue.nullable() })).max(API_LIMITS.headers).default([]),
});
export type ApiSettingsInput = z.infer<typeof ApiSettingsInput>;

/**
 * The settings as the API shows them: headers without values. `url` is empty when the stored settings can no longer
 * be opened (the key changed): the manager enters the address and the header values again.
 */
export const ApiSettingsDto = ApiSettings.omit({ headers: true, url: true }).extend({ url: z.string(), headers: z.array(z.object({ name: z.string() })) });
export type ApiSettingsDto = z.infer<typeof ApiSettingsDto>;

export const toSettingsDto = ({ headers, ...rest }: ApiSettings): ApiSettingsDto => ({ ...rest, headers: headers.map(({ name }) => ({ name })) });

/**
 * What the database keeps: the address (it may carry a key) and the header values sealed (`SecretBox`), the rest as
 * it is. Settings saved before sealing have them plain and are read the same way.
 */
const StoredSettings = ApiSettings.extend({
  url: z.string(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
});

export function sealSettings(settings: ApiSettings, box = secrets()): Prisma.InputJsonObject {
  return { ...settings, url: box.seal(settings.url), headers: settings.headers.map((h) => ({ name: h.name, value: box.seal(h.value) })) };
}

/** New settings with the values of headers left `null` taken from the stored ones; a new header needs its value. */
export function mergeSettings(input: ApiSettingsInput, stored: ApiSettings | null): ApiSettings {
  const headers = input.headers.map(({ name, value }) => {
    const kept = value ?? stored?.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
    if (kept === undefined) throw HttpError.badRequest(`The value of the ${name} header is missing`, [{ path: ['api', 'headers'], message: 'Value required' }]);
    return { name, value: kept };
  });
  return { ...input, headers };
}

/** The stored settings opened; null when they are broken or no key opens them. */
export function storedSettings(value: unknown, box: SecretBox = secrets()): ApiSettings | null {
  const stored = StoredSettings.safeParse(value);
  if (!stored.success) return null;
  try {
    const opened = { ...stored.data, url: box.open(stored.data.url), headers: stored.data.headers.map((h) => ({ name: h.name, value: box.open(h.value) })) };
    const parsed = ApiSettings.safeParse(opened);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The settings to show: opened when they can be, else what is not secret, with the address empty. */
export function storedSettingsDto(value: unknown): ApiSettingsDto | null {
  const opened = storedSettings(value);
  if (opened) return toSettingsDto(opened);
  const stored = StoredSettings.safeParse(value);
  return stored.success ? toSettingsDto({ ...stored.data, url: '' }) : null;
}
