import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Counter, Histogram, register, type MetricObjectWithValues, type MetricValue } from 'prom-client';

/** Metrics of the current process in the default prom-client registry; every process exposes its own `/metrics`. */
export const metrics = {
  events: new Counter({
    name: 'bot_events_total',
    help: 'Discord events dispatched to module handlers',
    labelNames: ['event', 'module'] as const,
  }),
  handlerErrors: new Counter({
    name: 'bot_handler_errors_total',
    help: 'Failed module handlers (events, commands, components)',
    labelNames: ['module', 'handler'] as const,
  }),
  commandDuration: new Histogram({
    name: 'bot_command_duration_seconds',
    help: 'Slash command execution time',
    labelNames: ['command', 'status'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),
  jobs: new Counter({
    name: 'jobs_total',
    help: 'Scheduled jobs run by the worker',
    labelNames: ['job', 'status'] as const,
  }),
};

export const metricsContentType = register.contentType;

/** Prometheus text format of the default registry. */
export function renderMetrics(): Promise<string> {
  return register.metrics();
}

/** A serializable snapshot of the registry: clusters send it to the manager over IPC. */
export function metricsSnapshot(): Promise<MetricObjectWithValues<MetricValue<string>>[]> {
  return register.getMetricsAsJSON();
}

export interface MetricsRequestOptions {
  /** Expected `Authorization: Bearer <token>`; unset — `/metrics` is open (reachable only inside the Docker network). */
  token?: string;
  /** Prometheus text; the default registry of this process unless overridden (the bot manager aggregates clusters). */
  render?: () => Promise<string>;
  onError?: (err: unknown) => void;
}

function sameToken(header: string | undefined, token: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${token}`));
}

/** Serves `GET /metrics` on a plain node:http server; returns `false` for other requests so the caller can handle them. */
export function handleMetricsRequest(req: IncomingMessage, res: ServerResponse, options: MetricsRequestOptions = {}): boolean {
  if (req.method !== 'GET' || req.url !== '/metrics') return false;
  if (options.token && !sameToken(req.headers.authorization, options.token)) {
    res.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
    return true;
  }
  (options.render ?? renderMetrics)().then(
    (body) => res.writeHead(200, { 'content-type': metricsContentType }).end(body),
    (err: unknown) => {
      options.onError?.(err);
      res.writeHead(500).end();
    },
  );
  return true;
}
