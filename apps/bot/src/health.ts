import { createServer, type Server } from 'node:http';
import type { Logger } from '@bot/logger';

export interface ClusterStatus {
  id: number;
  ready: boolean;
}

export interface HealthResponse {
  statusCode: number;
  body: { status: 'ok' | 'starting'; clusters: ClusterStatus[] };
}

export function healthResponse(clusters: ClusterStatus[]): HealthResponse {
  const ok = clusters.length > 0 && clusters.every((c) => c.ready);
  return { statusCode: ok ? 200 : 503, body: { status: ok ? 'ok' : 'starting', clusters } };
}

export interface HealthServerOptions {
  getClusters: () => ClusterStatus[];
  /** Prometheus text served at `/metrics`. */
  getMetrics: () => Promise<string>;
  metricsContentType: string;
}

export function startHealthServer(port: number, { getClusters, getMetrics, metricsContentType }: HealthServerOptions, logger: Logger): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      getMetrics().then(
        (body) => res.writeHead(200, { 'content-type': metricsContentType }).end(body),
        (err: unknown) => {
          logger.error({ err }, 'Failed to collect metrics');
          res.writeHead(500).end();
        },
      );
      return;
    }
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const { statusCode, body } = healthResponse(getClusters());
    res.writeHead(statusCode, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  server.listen(port, () => logger.info({ port }, 'Health server listening'));
  return server;
}
