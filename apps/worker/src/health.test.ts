import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@bot/db';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerHealthServer } from './health.js';

describe('worker health server', () => {
  let server: ReturnType<typeof createWorkerHealthServer>;
  let port: number;

  const db = {
    $queryRaw: vi.fn(async () => [{ 1: 1 }]),
  } as unknown as PrismaClient;

  const redis = {
    ping: vi.fn(async () => 'PONG'),
  } as unknown as Redis;

  let shuttingDown = false;
  let jobsRunning = true;

  const jobs = {
    getStatus: vi.fn(() => ({
      running: jobsRunning,
      inFlight: 0,
      lastTickAt: new Date().toISOString(),
    })),
  };

  beforeEach(async () => {
    shuttingDown = false;
    jobsRunning = true;
    vi.clearAllMocks();

    server = createWorkerHealthServer({
      db,
      redis,
      jobs,
      isShuttingDown: () => shuttingDown,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /health returns 200 ok unconditionally', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready returns 200 ok when db, redis and jobs are healthy', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      db: 'ok',
      redis: 'ok',
      jobs: { running: true },
    });
  });

  it('GET /ready returns 503 when shutting down', async () => {
    shuttingDown = true;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unavailable', reason: 'shutting_down' });
  });

  it('GET /ready returns 503 when DB fails', async () => {
    vi.mocked(db.$queryRaw).mockRejectedValueOnce(new Error('Connection lost'));
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'unavailable',
      db: 'error',
      redis: 'ok',
    });
  });

  it('GET /ready returns 503 when Redis fails', async () => {
    vi.mocked(redis.ping).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'unavailable',
      db: 'ok',
      redis: 'error',
    });
  });

  it('GET /ready returns 503 when jobs are not running', async () => {
    jobsRunning = false;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'unavailable',
      db: 'ok',
      redis: 'ok',
      jobs: { running: false },
    });
  });
});
