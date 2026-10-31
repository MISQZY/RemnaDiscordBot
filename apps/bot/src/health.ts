import { createServer, type Server } from 'node:http';
import { handleMetricsRequest } from '@bot/core';
import type { Logger } from '@bot/logger';

export interface ClusterStatus {
  id: number;
  ready: boolean;
}

export interface HealthResponse {
  statusCode: number;
  body: { status: 'ok' | 'starting'; clusters: ClusterStatus[] };
}

export function healthResponse(clusters: ClusterStatus[], managerReady?: boolean): HealthResponse {
  const ok = (managerReady ?? clusters.length > 0) && clusters.every((c) => c.ready);
  return { statusCode: ok ? 200 : 503, body: { status: ok ? 'ok' : 'starting', clusters } };
}

export interface HealthServerOptions {
  getClusters: () => ClusterStatus[];
  /** Prometheus text served at `/metrics`. */
  getMetrics: () => Promise<string>;
  metricsToken?: string;
  /** Dynamic managers can be healthy while waiting for assignments. */
  managerReady?: () => boolean;
}

export function startHealthServer(port: number, { getClusters, getMetrics, metricsToken, managerReady }: HealthServerOptions, logger: Logger): Server {
  const server = createServer((req, res) => {
    const onError = (err: unknown) => logger.error({ err }, 'Failed to collect metrics');
    if (handleMetricsRequest(req, res, { token: metricsToken, render: getMetrics, onError })) return;
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const { statusCode, body } = healthResponse(getClusters(), managerReady?.());
    res.writeHead(statusCode, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  server.listen(port, () => logger.info({ port }, 'Health server listening'));
  return server;
}
