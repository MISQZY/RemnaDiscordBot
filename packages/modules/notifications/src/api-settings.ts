import { HttpError } from '@bot/core';
import { z } from 'zod';

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

/** The settings as the API shows them: headers without values. */
export const ApiSettingsDto = ApiSettings.omit({ headers: true }).extend({ headers: z.array(z.object({ name: z.string() })) });
export type ApiSettingsDto = z.infer<typeof ApiSettingsDto>;

export const toSettingsDto = ({ headers, ...rest }: ApiSettings): ApiSettingsDto => ({ ...rest, headers: headers.map(({ name }) => ({ name })) });

/** New settings with the values of headers left `null` taken from the stored ones; a new header needs its value. */
export function mergeSettings(input: ApiSettingsInput, stored: ApiSettings | null): ApiSettings {
  const headers = input.headers.map(({ name, value }) => {
    const kept = value ?? stored?.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
    if (kept === undefined) throw HttpError.badRequest(`The value of the ${name} header is missing`, [{ path: ['api', 'headers'], message: 'Value required' }]);
    return { name, value: kept };
  });
  return { ...input, headers };
}

export const storedSettings = (value: unknown): ApiSettings | null => {
  const parsed = ApiSettings.safeParse(value);
  return parsed.success ? parsed.data : null;
};
