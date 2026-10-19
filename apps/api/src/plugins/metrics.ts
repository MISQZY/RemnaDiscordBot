import type { FastifyInstance } from 'fastify';
import { Counter, Histogram } from 'prom-client';

const requests = new Counter({
  name: 'api_http_requests_total',
  help: 'HTTP requests handled by the API',
  labelNames: ['method', 'route', 'status'] as const,
});

const duration = new Histogram({
  name: 'api_http_request_duration_seconds',
  help: 'HTTP request handling time',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/** Counts requests by route pattern (not the raw URL, so guild ids do not explode the label set). */
export function registerHttpMetrics(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    requests.inc({ method: request.method, route, status: String(reply.statusCode) });
    duration.observe({ method: request.method, route }, reply.elapsedTime / 1000);
  });
}
