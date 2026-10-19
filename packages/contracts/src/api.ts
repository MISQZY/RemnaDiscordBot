import { z } from 'zod';
import { Locale, ModuleId, Snowflake } from './common.js';
import { GuildMeta } from './guild.js';
import { ClusterHeartbeat } from './messages.js';

/** DTO REST API `/v1`. Одни и те же схемы валидируют запросы в API и типизируют клиент веба. */

export const ApiErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'BOT_NOT_IN_GUILD',
  'NOT_FOUND',
  'MODULE_NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'RATE_LIMITED',
  'DISCORD_UNAVAILABLE',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    details: z
      .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
      .optional(),
    requestId: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const CurrentUser = z.object({
  id: Snowflake,
  username: z.string(),
  globalName: z.string().nullable(),
  avatar: z.string().nullable(),
});
export type CurrentUser = z.infer<typeof CurrentUser>;

export const UserGuild = z.object({
  id: Snowflake,
  name: z.string(),
  icon: z.string().nullable(),
  owner: z.boolean(),
  /** Владелец, Administrator или Manage Server — может настраивать бота. */
  canManage: z.boolean(),
  botPresent: z.boolean(),
});
export type UserGuild = z.infer<typeof UserGuild>;

export const GuildSettings = z.object({
  locale: Locale,
  timezone: z.string(),
  modRoleIds: z.array(Snowflake),
});
export type GuildSettings = z.infer<typeof GuildSettings>;

export const GuildSettingsPatch = z
  .object({
    locale: Locale,
    timezone: z.string().refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz), 'Unknown time zone'),
    modRoleIds: z.array(Snowflake).max(25),
  })
  .partial();
export type GuildSettingsPatch = z.infer<typeof GuildSettingsPatch>;

export const GuildOverview = z.object({
  meta: GuildMeta,
  settings: GuildSettings,
});
export type GuildOverview = z.infer<typeof GuildOverview>;

export const ModuleInfo = z.object({
  id: ModuleId,
  name: z.string(),
  alwaysEnabled: z.boolean(),
  enabledByDefault: z.boolean(),
  /** JSON Schema конфига — для автогенерации форм в вебе. */
  configSchema: z.record(z.string(), z.unknown()),
});
export type ModuleInfo = z.infer<typeof ModuleInfo>;

export const ModuleState = z.object({
  id: ModuleId,
  enabled: z.boolean(),
  config: z.unknown(),
  /** `null` — конфиг не сохранялся, действуют значения по умолчанию. */
  updatedAt: z.iso.datetime().nullable(),
});
export type ModuleState = z.infer<typeof ModuleState>;

/** PUT: конфиг заменяется целиком. */
export const ModuleConfigReplace = z.object({
  enabled: z.boolean().optional(),
  config: z.unknown(),
});
export type ModuleConfigReplace = z.infer<typeof ModuleConfigReplace>;

/** PATCH: поля `config` сливаются с текущим конфигом (поверхностно), затем всё валидируется. */
export const ModuleConfigPatch = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type ModuleConfigPatch = z.infer<typeof ModuleConfigPatch>;

export const AuditLogEntry = z.object({
  id: z.string(),
  userId: Snowflake,
  moduleId: z.string().nullable(),
  action: z.string(),
  diff: z.unknown(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

export const AuditLogPage = z.object({
  items: z.array(AuditLogEntry),
  nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof AuditLogPage>;

export const BotStatus = z.object({
  clusters: z.array(ClusterHeartbeat),
});
export type BotStatus = z.infer<typeof BotStatus>;

export const InviteLink = z.object({ url: z.url() });
export type InviteLink = z.infer<typeof InviteLink>;
