import { Locale } from '@bot/contracts';
import { z } from 'zod';

const ManagerEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    DISCORD_TOKEN: z.string().min(1),
    TOTAL_SHARDS: z.union([z.literal('auto'), z.coerce.number().int().positive()]).default('auto'),
    SHARDS_PER_CLUSTER: z.coerce.number().int().positive().default(4),
    /** Servers the clusters are spread over (`sharding.ts`); the database and Redis stay on one of them. */
    SHARD_HOSTS: z.coerce.number().int().positive().default(1),
    /** This server among them, from 0; only the first one syncs slash commands. */
    SHARD_HOST_INDEX: z.coerce.number().int().min(0).default(0),
    BOT_HEALTH_PORT: z.coerce.number().int().positive().default(3001),
    /** Bearer token required by `/metrics`; set it when the metrics port is published outside the Docker network. */
    METRICS_TOKEN: z.string().min(16).optional(),
    DISCORD_DEV_GUILD_ID: z.string().optional(),
    /** Sync slash commands with Discord on startup (only differences are changed). */
    AUTO_DEPLOY_COMMANDS: z.stringbool().default(true),
  })
  // Every server must cut the shards alike, and Discord's recommendation may change between their starts.
  .refine((env) => env.SHARD_HOSTS === 1 || env.TOTAL_SHARDS !== 'auto', {
    path: ['TOTAL_SHARDS'],
    message: 'A number is required when SHARD_HOSTS > 1',
  })
  .refine((env) => env.SHARD_HOST_INDEX < env.SHARD_HOSTS, {
    path: ['SHARD_HOST_INDEX'],
    message: 'Must be below SHARD_HOSTS',
  });

const ClusterEnv = z.object({
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
