import { createRequire } from 'node:module';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import type { Redis } from 'ioredis';

// CommonJS-пакет; повторяет API ioredis, поэтому типизируется им.
const RedisMock = createRequire(import.meta.url)('ioredis-mock') as new (options: { port: number }) => Redis;

export interface MemoryRedisServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

type Reply = string | number | null | Buffer | Error | Reply[];

/** Методы клиента, которые не являются командами Redis. */
const NOT_COMMANDS = new Set(['duplicate', 'disconnect', 'connect', 'on', 'once', 'off', 'emit', 'pipeline', 'multi', 'exec']);

function encode(reply: Reply): string {
  if (reply === null || reply === undefined) return '$-1\r\n';
  if (reply instanceof Error) return `-ERR ${reply.message.replaceAll(/\r?\n/g, ' ')}\r\n`;
  if (typeof reply === 'number') return Number.isInteger(reply) ? `:${reply}\r\n` : encode(String(reply));
  if (Array.isArray(reply)) return `*${reply.length}\r\n${reply.map(encode).join('')}`;
  const value = Buffer.isBuffer(reply) ? reply.toString() : String(reply);
  return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
}

/** Разбирает одну команду RESP (массив bulk-строк) или inline-команду. `null` — данных пока мало. */
function parseCommand(buffer: Buffer, offset: number): { args: string[]; next: number } | null {
  const lineEnd = (from: number) => {
    const index = buffer.indexOf('\r\n', from);
    return index === -1 ? null : index;
  };

  if (buffer[offset] !== 0x2a /* '*' */) {
    const end = lineEnd(offset);
    if (end === null) return null;
    const args = buffer.toString('utf8', offset, end).trim().split(/\s+/).filter(Boolean);
    return { args, next: end + 2 };
  }

  const headerEnd = lineEnd(offset);
  if (headerEnd === null) return null;
  const count = Number(buffer.toString('utf8', offset + 1, headerEnd));
  const args: string[] = [];
  let cursor = headerEnd + 2;

  for (let i = 0; i < count; i++) {
    const sizeEnd = lineEnd(cursor);
    if (sizeEnd === null) return null;
    const size = Number(buffer.toString('utf8', cursor + 1, sizeEnd));
    const start = sizeEnd + 2;
    if (buffer.length < start + size + 2) return null;
    args.push(buffer.toString('utf8', start, start + size));
    cursor = start + size + 2;
  }
  return { args, next: cursor };
}

/**
 * Redis-совместимый сервер в памяти поверх ioredis-mock — для локального запуска
 * нескольких процессов (бот, API) без установленного Redis и контейнеров.
 * Поддерживает обычные команды, MULTI/EXEC и SUBSCRIBE/PUBLISH. Данные не сохраняются.
 */
export async function startMemoryRedisServer({ port = 0, host = '127.0.0.1' } = {}): Promise<MemoryRedisServer> {
  // Каждый сервер — отдельное хранилище: мок делит данные по «порту».
  const store = new RedisMock({ port: 50_000 + Math.floor(Math.random() * 10_000) });
  const sockets = new Set<Socket>();

  async function run(name: string, args: string[]): Promise<Reply> {
    const method = name.toLowerCase();
    const fn = (store as unknown as Record<string, unknown>)[method];
    if (!/^[a-z]+$/.test(method) || NOT_COMMANDS.has(method) || typeof fn !== 'function') {
      return new Error(`unknown command '${name}'`);
    }
    try {
      return (await (fn as (...a: string[]) => Promise<Reply>).apply(store, args)) ?? null;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  function handleConnection(socket: Socket): void {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());

    let buffer = Buffer.alloc(0);
    let queue: Promise<void> = Promise.resolve();
    let transaction: string[][] | null = null;
    let subscriber: Redis | null = null;
    const channels = new Set<string>();

    const write = (reply: Reply) => {
      if (!socket.destroyed) socket.write(encode(reply));
    };

    async function execute([name = '', ...args]: string[]): Promise<void> {
      const command = name.toUpperCase();

      if (transaction && !['EXEC', 'DISCARD', 'MULTI'].includes(command)) {
        transaction.push([name, ...args]);
        return write('QUEUED');
      }

      switch (command) {
        case 'MULTI':
          transaction = [];
          return write('OK');
        case 'DISCARD':
          transaction = null;
          return write('OK');
        case 'EXEC': {
          const queued = transaction ?? [];
          transaction = null;
          const results: Reply[] = [];
          for (const [queuedName = '', ...queuedArgs] of queued) results.push(await run(queuedName, queuedArgs));
          return write(results);
        }
        case 'HELLO':
          // Как Redis < 6: клиент откатывается с RESP3 на RESP2, которым отвечает сервер.
          return write(new Error(`unknown command '${name}'`));
        case 'PING':
          return write(args[0] ?? 'PONG');
        case 'SELECT':
        case 'CLIENT':
          return write('OK');
        case 'QUIT':
          write('OK');
          socket.end();
          return;
        case 'SUBSCRIBE': {
          if (!subscriber) {
            subscriber = store.duplicate();
            subscriber.on('message', (channel: string, message: string) => write(['message', channel, message]));
          }
          for (const channel of args) {
            await subscriber.subscribe(channel);
            channels.add(channel);
            write(['subscribe', channel, channels.size]);
          }
          return;
        }
        case 'UNSUBSCRIBE': {
          for (const channel of args.length > 0 ? args : [...channels]) {
            await subscriber?.unsubscribe(channel);
            channels.delete(channel);
            write(['unsubscribe', channel, channels.size]);
          }
          return;
        }
        default:
          return write(await run(name, args));
      }
    }

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let parsed = parseCommand(buffer, 0);
      while (parsed) {
        const { args } = parsed;
        buffer = buffer.subarray(parsed.next);
        // Команды выполняются строго по порядку — ответы должны идти в порядке запросов.
        if (args.length > 0) queue = queue.then(() => execute(args));
        parsed = buffer.length > 0 ? parseCommand(buffer, 0) : null;
      }
    });

    socket.on('close', () => {
      if (subscriber) subscriber.disconnect();
    });
  }

  const server = createServer(handleConnection);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const actualPort = (server.address() as AddressInfo).port;

  return {
    port: actualPort,
    url: `redis://${host}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        store.disconnect();
        server.close(() => resolve());
      }),
  };
}
