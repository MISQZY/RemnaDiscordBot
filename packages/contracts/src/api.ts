import { z } from 'zod';
import { Locale, ModuleId, Snowflake } from './common.js';
import { GuildMeta } from './guild.js';
import { ClusterHeartbeat } from './messages.js';

/** REST API `/v1` DTOs. The same schemas validate API requests and type the web client. */

export const ApiErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'BOT_NOT_IN_GUILD',
  'NOT_FOUND',
  'MODULE_NOT_FOUND',
  'MODULE_DISABLED',
  'VIP_REQUIRED',
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

/** External client login: the single-use code from the callback, exchanged for a bearer session token. */
export const SessionTokenRequest = z.object({ code: z.string().min(1).max(200) });
export type SessionTokenRequest = z.infer<typeof SessionTokenRequest>;

export const SessionToken = z.object({
  /** Sent as `Authorization: Bearer <token>`; lives 30 days after the last request. */
  token: z.string(),
  user: CurrentUser,
});
export type SessionToken = z.infer<typeof SessionToken>;

export const UserGuild = z.object({
  id: Snowflake,
  name: z.string(),
  icon: z.string().nullable(),
  owner: z.boolean(),
  /** Owner, Administrator or Manage Server — can configure the bot. */
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

/** A picture for Discord as the dashboard sends it: a data URI of PNG, JPEG, GIF or WebP, up to 8 MB. */
export const ImageDataUri = z
  .string()
  .max(11_200_000)
  .regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/, 'A PNG, JPEG, GIF or WebP data URI');

/** The bot's profile on one server: its own name, avatar, banner and "About me" there; `null` — the global one. */
export const BotProfile = z.object({
  nick: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  bio: z.string().nullable(),
  /** What shows where nothing is set for the server. */
  global: z.object({ name: z.string(), avatarUrl: z.string().nullable() }),
  /** Whether the bot's owner lets servers change it (BOT_PROFILE_EDITS). */
  editable: z.boolean(),
  /** Changing it needs VIP this server has not got. */
  vipRequired: z.boolean(),
});
export type BotProfile = z.infer<typeof BotProfile>;

/** Only what is sent changes; `null` resets to the global profile. */
export const BotProfilePatch = z
  .object({
    nick: z.string().trim().min(1).max(32).nullable(),
    avatar: ImageDataUri.nullable(),
    banner: ImageDataUri.nullable(),
    bio: z.string().trim().max(190).nullable(),
  })
  .partial();
export type BotProfilePatch = z.infer<typeof BotProfilePatch>;

/** The guild's active VIP: `expiresAt: null` — forever. */
export const GuildVipStatus = z.object({ expiresAt: z.iso.datetime().nullable() });
export type GuildVipStatus = z.infer<typeof GuildVipStatus>;

export const GuildOverview = z.object({
  meta: GuildMeta,
  settings: GuildSettings,
  /** `null` — no VIP: VIP modules work as disabled. */
  vip: GuildVipStatus.nullable(),
});
export type GuildOverview = z.infer<typeof GuildOverview>;

export const ModuleInfo = z.object({
  id: ModuleId,
  name: z.string(),
  alwaysEnabled: z.boolean(),
  enabledByDefault: z.boolean(),
  /** Works only in guilds with VIP. */
  vip: z.boolean(),
  /** Config JSON Schema — for generating forms in the web app. */
  configSchema: z.record(z.string(), z.unknown()),
});
export type ModuleInfo = z.infer<typeof ModuleInfo>;

export const ModuleState = z.object({
  id: ModuleId,
  enabled: z.boolean(),
  config: z.unknown(),
  /** `null` — the config was never saved, defaults apply. */
  updatedAt: z.iso.datetime().nullable(),
});
export type ModuleState = z.infer<typeof ModuleState>;

/** Parts of the bot outside modules that may need VIP: `profile` — changing the bot's profile on a server. */
export const VipFeature = z.enum(['profile']);
export type VipFeature = z.infer<typeof VipFeature>;

/**
 * VIP as an external dashboard keeps it (`PUT /v1/vip`, the whole state at once): which modules and features need it
 * and which guilds have it until when (`null` — forever). Dashboards from before the features send none.
 */
export const VipState = z.object({
  modules: z.array(ModuleId).max(100),
  features: z.array(VipFeature).max(VipFeature.options.length).default([]),
  guilds: z.array(z.object({ guildId: Snowflake, expiresAt: z.iso.datetime().nullable() })).max(100_000),
});
export type VipState = z.infer<typeof VipState>;

/** PUT: the config is replaced entirely. */
export const ModuleConfigReplace = z.object({
  enabled: z.boolean().optional(),
  config: z.unknown(),
});
export type ModuleConfigReplace = z.infer<typeof ModuleConfigReplace>;

/** PATCH: `config` fields are shallow-merged into the current config, then everything is validated. */
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
