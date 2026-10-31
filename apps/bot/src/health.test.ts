import { describe, expect, it } from 'vitest';
import { healthResponse } from './health.js';

describe('healthResponse', () => {
  it('is healthy when every cluster is ready', () => {
    expect(healthResponse([{ id: 0, ready: true }, { id: 1, ready: true }])).toMatchObject({
      statusCode: 200,
      body: { status: 'ok' },
    });
  });

  it('is starting while clusters spawn', () => {
    expect(healthResponse([]).statusCode).toBe(503);
    expect(healthResponse([{ id: 0, ready: true }, { id: 1, ready: false }]).body.status).toBe('starting');
  });

  it('accepts an idle dynamic manager only while coordination is healthy', () => {
    expect(healthResponse([], true).statusCode).toBe(200);
    expect(healthResponse([], false).statusCode).toBe(503);
    expect(healthResponse([{ id: 0, ready: false }], true).statusCode).toBe(503);
  });
});
