import { Locale } from '@bot/contracts';
import { z } from 'zod';
import { parseLinkClients } from './auth/link-clients.js';

const ApiEnv = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  /** Servers may change the bot's name, avatar, banner and "About me" on them from the dashboard. */
  BOT_PROFILE_EDITS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Global request limit per minute per user/IP; 0 — unlimited (load tests). */
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().nonnegative().default(120),
  /** Internal port for Prometheus `/metrics`; not published outside the Docker network. */
  API_METRICS_PORT: z.coerce.number().int().positive().default(9464),
  /** Bearer token required by `/metrics`; set it when the metrics port is published outside the Docker network. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** Public API URL — the OAuth2 redirect_uri is built from it. */
  API_PUBLIC_URL: z.url().default('http://localhost:3000'),
  /** Web platform URL: CORS and post-login redirect. Until the web app exists — Swagger on the API itself. */
  WEB_ORIGIN: z.url().optional(),
  /** Bot token: the API writes to Discord as the bot (publishing messages, test sends). */
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** External dashboards signing users in through the API: `id:secret:callbackUrl`, comma-separated. */
  LINK_CLIENTS: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      try {
        return parseLinkClients(raw);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
        return z.NEVER;
      }
    }),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DEFAULT_LOCALE: Locale.default('ru'),
});
export type ApiEnv = z.infer<typeof ApiEnv>;

export function loadApiEnv(): ApiEnv {
  // Treat empty strings from .env as unset so that defaults apply.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
  const result = ApiEnv.safeParse(raw);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}
