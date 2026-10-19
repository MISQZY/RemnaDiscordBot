import type { ScheduledAction } from '@bot/db';
import type { CoreServices, ModuleServices } from '../context.js';
import { metrics } from '../metrics.js';
import type { AnyModule } from '../module.js';
import { RedisKeys } from '../redis-keys.js';
import type { ModuleRegistry } from '../registry.js';

export interface JobRunnerOptions {
  batchSize?: number;
  /** How long a job counts as taken by a worker. */
  lockMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

/** Exponential retry delay: 10s, 20s, 40s… capped at one hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(10_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60_000);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Job timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Services and module config — what jobs and interval tasks receive. */
export function moduleServices(services: CoreServices, module: AnyModule): ModuleServices<unknown> {
  return {
    ...services,
    logger: services.logger.child({ moduleId: module.id }),
    moduleId: module.id,
    getConfig: async (guildId) => (await services.config.get(guildId, module.id)).config,
  };
}

/** Runs modules' scheduled jobs from `ScheduledAction`. */
export class JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private readonly options: Required<JobRunnerOptions>;

  constructor(
    private readonly services: CoreServices,
    private readonly registry: ModuleRegistry,
    options: JobRunnerOptions = {},
  ) {
    this.options = { batchSize: 20, lockMs: 60_000, maxAttempts: 5, timeoutMs: 30_000, ...options };
  }

  /** One pass: claim due jobs and run them. Returns the number of jobs. */
  async tick(): Promise<number> {
    const { batchSize, lockMs, maxAttempts } = this.options;
    const actions = await this.services.scheduler.claimDue({ limit: batchSize, lockMs, maxAttempts });
    await Promise.all(actions.map((action) => this.run(action)));
    return actions.length;
  }

  start(pollMs: number): void {
    const loop = async () => {
      if (this.stopped) return;
      this.running = this.tick().catch((err: unknown) => this.services.logger.error({ err }, 'Job tick failed'));
      await this.running;
      if (!this.stopped) this.timer = setTimeout(() => void loop(), pollMs);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async run(action: ScheduledAction): Promise<void> {
    const { scheduler, logger } = this.services;
    const entry = this.registry.findJob(action.type);
    if (!entry) {
      await scheduler.fail(action.id, `Unknown job type ${action.type}`, null);
      metrics.jobs.inc({ job: action.type, status: 'unknown' });
      logger.error({ actionId: action.id, type: action.type }, 'Unknown job type');
      return;
    }

    try {
      const ctx = { ...moduleServices(this.services, entry.module), guildId: action.guildId };
      await withTimeout(Promise.resolve(entry.item(action.payload, ctx)), this.options.timeoutMs);
      await scheduler.complete(action.id);
      metrics.jobs.inc({ job: action.type, status: 'ok' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = action.attempts >= this.options.maxAttempts;
      await scheduler.fail(action.id, message, giveUp ? null : new Date(Date.now() + retryDelayMs(action.attempts)));
      metrics.jobs.inc({ job: action.type, status: giveUp ? 'given_up' : 'retry' });
      logger.warn({ err, actionId: action.id, type: action.type, attempts: action.attempts, giveUp }, 'Job failed');
    }
  }
}

/**
 * Modules' interval tasks. A Redis lock for the period guarantees
 * that with several workers a task runs once per period.
 */
export class IntervalRunner {
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly services: CoreServices,
    private readonly registry: ModuleRegistry,
  ) {}

  /** Runs the task unless someone already ran it in this period. */
  async runOnce(moduleId: string, name: string): Promise<boolean> {
    const module = this.registry.get(moduleId);
    const task = module?.intervals?.[name];
    if (!module || !task) throw new Error(`Unknown interval ${moduleId}:${name}`);

    const lock = await this.services.redis.set(RedisKeys.intervalLock(moduleId, name), '1', 'PX', task.everyMs, 'NX');
    if (!lock) return false;
    try {
      await task.run(moduleServices(this.services, module));
    } catch (err) {
      metrics.handlerErrors.inc({ module: moduleId, handler: `interval:${name}` });
      this.services.logger.error({ err, moduleId, interval: name }, 'Interval task failed');
    }
    return true;
  }

  start(): void {
    for (const module of this.registry.all()) {
      for (const [name, task] of Object.entries(module.intervals ?? {})) {
        const timer = setInterval(() => void this.runOnce(module.id, name), task.everyMs);
        timer.unref();
        this.timers.push(timer);
      }
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
  }
}
