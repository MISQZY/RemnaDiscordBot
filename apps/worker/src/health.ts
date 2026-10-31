import { createServer, type Server } from 'node:http';
import type { PrismaClient } from '@bot/db';
import { handleMetricsRequest, type JobRunner } from '@bot/core';
import type { Redis } from 'ioredis';

export interface WorkerHealthOptions {
  db: PrismaClient;
  redis: Redis;
  jobs: Pick<JobRunner, 'getStatus'>;
  isShuttingDown: () => boolean;
  metricsToken?: string;
  onError?: (err: unknown) => void;
}

export function createWorkerHealthServer(options: WorkerHealthOptions): Server {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/ready') {
      if (options.isShuttingDown()) {
        res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'unavailable', reason: 'shutting_down' }));
        return;
      }
      try {
        const [dbCheck, redisCheck] = await Promise.allSettled([
          options.db.$queryRaw`SELECT 1`,
          options.redis.ping(),
        ]);

        const dbOk = dbCheck.status === 'fulfilled';
        const redisOk = redisCheck.status === 'fulfilled' && redisCheck.value === 'PONG';
        const jobsStatus = options.jobs.getStatus();
        const ok = dbOk && redisOk && jobsStatus.running;

        const body = JSON.stringify({
          status: ok ? 'ok' : 'unavailable',
          db: dbOk ? 'ok' : 'error',
          redis: redisOk ? 'ok' : 'error',
          jobs: jobsStatus,
        });

        res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(body);
      } catch (err) {
        res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({
          status: 'unavailable',
          error: (err as Error).message,
        }));
      }
      return;
    }

    if (!handleMetricsRequest(req, res, { token: options.metricsToken, onError: options.onError })) {
      res.writeHead(404).end();
    }
  });
}
