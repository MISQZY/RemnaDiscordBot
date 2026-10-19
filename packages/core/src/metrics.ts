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
