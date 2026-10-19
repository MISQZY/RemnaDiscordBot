import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * An external dashboard (another site embedding the panel) that signs users in through this API
 * and then calls it on their behalf with a bearer session token.
 */
export interface LinkClient {
  id: string;
  secret: string;
  /** Where the browser lands after Discord login: `?code=…&state=…` or `?error=…&state=…`. */
  callbackUrl: string;
}

const CLIENT_ID = /^[a-z][a-z0-9-]{1,31}$/;
const MIN_SECRET_LENGTH = 32;

/** Parses `id:secret:callbackUrl` entries separated by commas; throws on a malformed one. */
export function parseLinkClients(raw: string | undefined): LinkClient[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((entry) => {
    const [id = '', secret = '', ...rest] = entry.trim().split(':');
    const callbackUrl = rest.join(':');
    if (!CLIENT_ID.test(id)) throw new Error(`LINK_CLIENTS: invalid client id "${id}"`);
    if (secret.length < MIN_SECRET_LENGTH) throw new Error(`LINK_CLIENTS: secret of "${id}" must be at least ${MIN_SECRET_LENGTH} characters`);
    if (!URL.canParse(callbackUrl) || !/^https?:$/.test(new URL(callbackUrl).protocol)) {
      throw new Error(`LINK_CLIENTS: invalid callback URL of "${id}"`);
    }
    return { id, secret, callbackUrl };
  });
}

/** Constant-time comparison of strings of any length. */
function sameSecret(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** The client of an `Authorization: Basic base64(id:secret)` header; `null` when unknown or the secret is wrong. */
export function authenticateClient(clients: LinkClient[], authorization: string | undefined): LinkClient | null {
  const match = /^Basic\s+(\S+)$/i.exec(authorization ?? '');
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  const client = clients.find((c) => c.id === decoded.slice(0, separator));
  return client && sameSecret(client.secret, decoded.slice(separator + 1)) ? client : null;
}

/** The client's callback URL with the given query parameters. */
export function clientRedirect(client: LinkClient, params: Record<string, string>): string {
  const url = new URL(client.callbackUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
