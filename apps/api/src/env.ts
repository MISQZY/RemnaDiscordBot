import { Locale } from '@bot/contracts';
import { z } from 'zod';

const ApiEnv = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  /** Публичный адрес API — из него строится redirect_uri OAuth2. */
  API_PUBLIC_URL: z.url().default('http://localhost:3000'),
  /** Адрес веб-платформы: CORS и редирект после входа. Пока веба нет — Swagger на самом API. */
  WEB_ORIGIN: z.url().optional(),
  /** Токен бота: API пишет в Discord от имени бота (публикация сообщений, тестовые отправки). */
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DEFAULT_LOCALE: Locale.default('ru'),
});
export type ApiEnv = z.infer<typeof ApiEnv>;

export function loadApiEnv(): ApiEnv {
  // Пустые строки из .env считаем незаданными, чтобы сработали значения по умолчанию.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
  const result = ApiEnv.safeParse(raw);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}
