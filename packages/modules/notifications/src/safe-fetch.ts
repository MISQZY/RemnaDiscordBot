import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

// Fetching addresses that users type in: only the public internet, a bounded body, few redirects.
// The addresses are checked when the connection is made, so a name cannot resolve to a public address
// for a check and to a private one for the request.

/** Networks that are not the public internet: loopback, private, link-local, carrier NAT, documentation, multicast. */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
// IPv4-mapped addresses (::ffff:a.b.c.d) are checked against the IPv4 rules by BlockList itself; a ::ffff:0:0/96
// rule would block every IPv4 address. NAT64 and 6to4 ones may hide a private IPv4 address, so they are blocked whole.
for (const [network, prefix] of [
  ['::', 127],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;
  return !blocked.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Networks allowed besides the public internet, from `FETCH_ALLOW_NETWORKS` (`198.18.0.0/15,10.1.0.0/16`): for a
 * machine whose VPN answers DNS with addresses of its own (fake-ip), never needed on a server. A wrong entry fails
 * loudly, not silently allowing less.
 */
export function allowedNetworks(value = process.env.FETCH_ALLOW_NETWORKS ?? ''): BlockList {
  const allowed = new BlockList();
  for (const entry of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [network = '', prefix] = entry.split('/');
    const version = isIP(network);
    const bits = Number(prefix);
    if (version === 0 || !Number.isInteger(bits) || bits < 0 || bits > (version === 4 ? 32 : 128)) {
      throw new Error(`FETCH_ALLOW_NETWORKS: "${entry}" is not a network like 198.18.0.0/15`);
    }
    allowed.addSubnet(network, bits, version === 4 ? 'ipv4' : 'ipv6');
  }
  return allowed;
}

let extra: BlockList | undefined;

/** A public address, or one in FETCH_ALLOW_NETWORKS. */
export function isAllowedAddress(address: string): boolean {
  if (isPublicAddress(address)) return true;
  const version = isIP(address);
  return version !== 0 && (extra ??= allowedNetworks()).check(address, version === 4 ? 'ipv4' : 'ipv6');
}

/** The address is not on the public internet, or the response broke a limit. */
export class FetchRefused extends Error {}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** `dns.lookup` that refuses names with any address that is not allowed. */
const guardedLookup =
  (isAllowed: (address: string) => boolean) =>
  (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      if (addresses.length === 0 || addresses.some((a) => !isAllowed(a.address))) {
        return callback(new FetchRefused(`${hostname} is not a public address`), []);
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };

export interface FetchedText {
  /** The address after redirects. */
  url: string;
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

export type FetchText = (url: string, headers?: Record<string, string>) => Promise<FetchedText>;

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Which addresses may be connected to: public ones and FETCH_ALLOW_NETWORKS; tests allow the loopback one. */
  isAllowed?: (address: string) => boolean;
  /**
   * How long making the connection (TCP and TLS) may take before it is dropped and made once more. A handshake that
   * hangs (a VPN or NAT waking up after idle) then costs a few seconds, not the whole request.
   */
  connectTimeoutMs?: number;
}

const DEFAULTS: Required<SafeFetchOptions> = {
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
  userAgent: 'Mozilla/5.0 (compatible; feed reader)',
  isAllowed: isAllowedAddress,
  connectTimeoutMs: 4_000,
};

/** The connection was not made in time: worth one more try. */
class ConnectTimeout extends Error {}

function decompress(response: IncomingMessage): Readable {
  switch (response.headers['content-encoding']?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return response.pipe(createGunzip());
    case 'deflate':
      return response.pipe(createInflate());
    case 'br':
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

/** The charset from Content-Type, else from the XML declaration; UTF-8 when neither names a known one. */
export function decodeBody(bytes: Buffer, contentType: string | undefined): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ?? /^\s*<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(bytes.subarray(0, 200).toString('latin1'))?.[1];
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function requestOnce(url: URL, headers: Record<string, string>, options: Required<SafeFetchOptions>, signal: AbortSignal) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, { headers, lookup: guardedLookup(options.isAllowed) as never, signal }, (response) => {
      const status = response.statusCode ?? 0;
      // A redirect's, a 304's or an error's body is not needed.
      if (status >= 300) {
        response.resume();
        return resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
      }
      const declared = Number(response.headers['content-length']);
      if (declared > options.maxBytes) {
        response.destroy();
        return reject(new FetchRefused(`The response is larger than ${options.maxBytes} bytes`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const body = decompress(response);
      body.on('data', (chunk: Buffer) => {
        // Counted after decompression: a small compressed body may unpack into a huge one.
        size += chunk.length;
        if (size > options.maxBytes) {
          response.destroy();
          body.destroy();
          reject(new FetchRefused(`The response is larger than ${options.maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      body.on('end', () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
      body.on('error', reject);
    });
    request.on('error', reject);
    // A socket kept alive from an earlier request is connected already; a new one gets until the handshake ends.
    request.on('socket', (socket) => {
      if (!socket.connecting) return;
      const timer = setTimeout(() => request.destroy(new ConnectTimeout(`No connection in ${options.connectTimeoutMs} ms`)), options.connectTimeoutMs);
      socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () => clearTimeout(timer));
      socket.once('close', () => clearTimeout(timer));
    });
  });
}

/** The request, made once more on a new connection when the first could not be made in time. */
async function requestWithRetry(url: URL, headers: Record<string, string>, options: Required<SafeFetchOptions>, signal: AbortSignal) {
  try {
    return await requestOnce(url, headers, options, signal);
  } catch (err) {
    if (!(err instanceof ConnectTimeout) || signal.aborted) throw err;
    return requestOnce(url, headers, options, signal);
  }
}

/** GET over http(s) to public addresses only, following a few redirects; the body is decoded to text. */
export function createSafeFetch(opts: SafeFetchOptions = {}): FetchText {
  const options = { ...DEFAULTS, ...opts };
  return async (address, extraHeaders = {}) => {
    const signal = AbortSignal.timeout(options.timeoutMs);
    const headers = { 'user-agent': options.userAgent, 'accept-encoding': 'gzip, deflate, br', ...extraHeaders };
    let url = new URL(address);
    for (let redirects = 0; ; redirects++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchRefused(`${url.protocol} is not allowed`);
      if (url.username || url.password) throw new FetchRefused('Credentials in the address are not allowed');
      // A literal IP is connected to without a lookup, so it is checked here.
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(host) !== 0 && !options.isAllowed(host)) throw new FetchRefused(`${host} is not a public address`);

      const response = await requestWithRetry(url, headers, options, signal);
      const location = response.headers.location;
      if (response.status >= 300 && response.status < 400 && location) {
        if (redirects >= options.maxRedirects) throw new FetchRefused('Too many redirects');
        url = new URL(location, url);
        continue;
      }
      const flat = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));
      return { url: url.toString(), status: response.status, headers: flat, body: decodeBody(response.body, flat['content-type']) };
    }
  };
}
