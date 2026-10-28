import { Locale } from '@bot/contracts';
import { z } from 'zod';

const WorkerEnv = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DISCORD_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DEFAULT_LOCALE: Locale.default('ru'),
  /** Seals secrets kept in the database (notification API keys, webhook tokens); without it — the bot token. Replacing both loses them. */
  SECRETS_KEY: z.string().min(32, 'SECRETS_KEY must be at least 32 characters').optional(),
  /** The previous SECRETS_KEY while the values move to the new one (an hour); then remove it. */
  SECRETS_KEY_OLD: z.string().min(32, 'SECRETS_KEY_OLD must be at least 32 characters').optional(),
  /** How often to check for due scheduled jobs. */
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2_000),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3002),
  /** Bearer token required by `/metrics`; set it when the metrics port is published outside the Docker network. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** Data of a guild the bot left is deleted after this many days. */
  GUILD_DATA_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),
  /** Finished scheduled jobs are kept this many days. */
  JOB_HISTORY_DAYS: z.coerce.number().int().min(0).default(7),
});
export type WorkerEnv = z.infer<typeof WorkerEnv>;

export function loadWorkerEnv(): WorkerEnv {
  // Treat empty strings from .env as unset so that defaults apply.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
  const result = WorkerEnv.safeParse(raw);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}
