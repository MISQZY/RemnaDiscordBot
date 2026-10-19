import { Locale } from '@bot/contracts';
import { z } from 'zod';

const ManagerEnv = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DISCORD_TOKEN: z.string().min(1),
  TOTAL_SHARDS: z.union([z.literal('auto'), z.coerce.number().int().positive()]).default('auto'),
  SHARDS_PER_CLUSTER: z.coerce.number().int().positive().default(4),
  BOT_HEALTH_PORT: z.coerce.number().int().positive().default(3001),
  /** Bearer token required by `/metrics`; set it when the metrics port is published outside the Docker network. */
  METRICS_TOKEN: z.string().min(16).optional(),
  DISCORD_DEV_GUILD_ID: z.string().optional(),
  /** Sync slash commands with Discord on startup (only differences are changed). */
  AUTO_DEPLOY_COMMANDS: z.stringbool().default(true),
});

const ClusterEnv = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DISCORD_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DEFAULT_LOCALE: Locale.default('ru'),
});

const DeployEnv = z.object({
  LOG_LEVEL: z.string().default('info'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_DEV_GUILD_ID: z.string().optional(),
});

function load<T extends z.ZodType>(schema: T): z.output<T> {
  // Treat empty strings from .env as unset so that defaults apply.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}

export const loadManagerEnv = () => load(ManagerEnv);
export const loadClusterEnv = () => load(ClusterEnv);
export const loadDeployEnv = () => load(DeployEnv);
