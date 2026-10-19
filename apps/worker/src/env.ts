import { Locale } from '@bot/contracts';
import { z } from 'zod';

const WorkerEnv = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DISCORD_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DEFAULT_LOCALE: Locale.default('ru'),
  /** Как часто проверять готовые отложенные задачи. */
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2_000),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3002),
});
export type WorkerEnv = z.infer<typeof WorkerEnv>;

export function loadWorkerEnv(): WorkerEnv {
  // Пустые строки из .env считаем незаданными, чтобы сработали значения по умолчанию.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
  const result = WorkerEnv.safeParse(raw);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}
