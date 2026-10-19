import type { REST } from 'discord.js';

export interface RestCall {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  route: string;
  body?: unknown;
}

/** Discord REST без сети: записывает вызовы, отвечает по маршруту. */
export class FakeRest {
  readonly calls: RestCall[] = [];
  /** Ответы по точному маршруту; по умолчанию — `{ id }` с новым snowflake. */
  readonly responses = new Map<string, unknown>();
  private created = 0;

  asRest(): REST {
    return this as unknown as REST;
  }

  get = (route: string) => this.record('get', route);
  post = (route: string, options?: { body?: unknown }) => this.record('post', route, options?.body);
  patch = (route: string, options?: { body?: unknown }) => this.record('patch', route, options?.body);
  put = (route: string, options?: { body?: unknown }) => this.record('put', route, options?.body);
  delete = (route: string) => this.record('delete', route);

  private async record(method: RestCall['method'], route: string, body?: unknown): Promise<unknown> {
    this.calls.push({ method, route, ...(body === undefined ? {} : { body }) });
    if (this.responses.has(route)) return this.responses.get(route);
    return { id: String(900_000_000_000_000_000n + BigInt(++this.created)) };
  }
}
