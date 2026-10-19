import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleMetricsRequest } from './metrics.js';

describe('handleMetricsRequest', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (!handleMetricsRequest(req, res, { token: 'metrics-token-1234', render: async () => 'up 1\n' })) res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('serves metrics with the right bearer token', async () => {
    const response = await fetch(`${url}/metrics`, { headers: { authorization: 'Bearer metrics-token-1234' } });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('up 1\n');
  });

  it('rejects a missing or wrong token', async () => {
    expect((await fetch(`${url}/metrics`)).status).toBe(401);
    expect((await fetch(`${url}/metrics`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('leaves other paths to the caller', async () => {
    expect((await fetch(`${url}/health`)).status).toBe(404);
  });
});
