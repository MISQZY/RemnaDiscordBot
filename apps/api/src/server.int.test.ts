import { renderMetrics } from '@bot/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/app.js';

describe('API server', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('reports liveness and readiness', async () => {
    expect((await t.app.inject('/health')).json()).toEqual({ status: 'ok' });

    const ready = await t.app.inject('/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok' });
  });

  it('returns unknown routes in the common error format', async () => {
    const response = await t.app.inject('/v1/nope');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND', requestId: expect.stringMatching(/^req_/) } });
  });

  it('counts requests by route pattern', async () => {
    await t.app.inject('/v1/guilds/300000000000000003/modules');
    const metrics = await renderMetrics();

    expect(metrics).toContain('api_http_requests_total{method="GET",route="/v1/guilds/:guildId/modules",status="401"}');
    expect(metrics).not.toContain('300000000000000003');
  });

  it('serves the OpenAPI document', async () => {
    const response = await t.app.inject('/docs/json');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ openapi: expect.stringMatching(/^3\./), info: { title: 'DiscordBot API' } });
  });
});
