import { randomUUID } from 'node:crypto';
import {
  ModuleCatalogItem,
  ModuleConfigPatch,
  ModuleConfigReplace,
  type ModuleDiagnosticIssue,
  ModuleDiagnosticResult,
  ModuleId,
  ModuleInfo,
  ModuleState,
  ModuleSummaryState,
  Snowflake,
} from '@bot/contracts';
import { ConfigConflictError, HttpError, moduleServices, UnknownModuleError, type AnyModule, type ConfigPatch, type ResolvedConfig } from '@bot/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { recordAudit } from '../audit.js';
import type { UserGuildService } from '../auth/user-guilds.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';
import { requireGuildAccess } from '../plugins/guild-access.js';
import { guildWriteLimit } from '../plugins/rate-limit.js';
import { requireSession } from '../plugins/session.js';

const GuildParams = z.object({ guildId: Snowflake });
const ModuleParams = GuildParams.extend({ moduleId: ModuleId });

/** Config ETag: changes on every save. */
export function configEtag(resolved: ResolvedConfig): string {
  return `"${resolved.updatedAt ?? 'default'}"`;
}

function toState(id: string, resolved: ResolvedConfig): ModuleState {
  return {
    id,
    enabled: resolved.enabled,
    config: resolved.config,
    updatedAt: resolved.updatedAt,
    applied: resolved.applied,
    applyError: resolved.applyError,
  };
}

function toSummaryState(id: string, resolved: ResolvedConfig): ModuleSummaryState {
  return {
    id,
    enabled: resolved.enabled,
    updatedAt: resolved.updatedAt,
    applied: resolved.applied,
    applyError: resolved.applyError,
  };
}

export function moduleRoutes(deps: ApiDeps, userGuilds: UserGuildService): FastifyPluginAsyncZod {
  const { registry, config, i18n, db, snapshots } = deps;

  const requireModule = (moduleId: string): AnyModule => {
    const module = registry.get(moduleId);
    if (!module) throw new UnknownModuleError(moduleId);
    return module;
  };

  const guildEntities = async (guildId: string) => ({
    channels: (await snapshots.getChannels(guildId)) ?? [],
    roles: (await snapshots.getRoles(guildId)) ?? [],
  });

  async function withApplyLock<T>(guildId: string, moduleId: string, run: () => Promise<T>): Promise<T> {
    const key = `lock:apply:${guildId}:${moduleId}`;
    const token = randomUUID();
    if (!(await deps.redis.set(key, token, 'EX', 60, 'NX'))) {
      throw ApiError.conflict('Apply operation is already in progress');
    }
    const renew = setInterval(() => {
      void deps.redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], 60) end return 0',
        1, key, token,
      ).catch((err: unknown) => deps.logger.warn({ err, guildId, moduleId }, 'Failed to renew module apply lock'));
    }, 20_000);
    renew.unref();
    try {
      return await run();
    } finally {
      clearInterval(renew);
      await deps.redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0',
        1, key, token,
      );
    }
  }

  /** Common write path: If-Match → validation and save → audit → new ETag. */
  async function applyUpdate(
    request: FastifyRequest,
    reply: FastifyReply,
    params: { guildId: string; moduleId: string },
    buildPatch: (current: ResolvedConfig) => ConfigPatch,
    action: string,
  ): Promise<ModuleState> {
    return withApplyLock(params.guildId, params.moduleId, () => applyUpdateUnlocked(request, reply, params, buildPatch, action));
  }

  async function applyUpdateUnlocked(
    request: FastifyRequest,
    reply: FastifyReply,
    { guildId, moduleId }: { guildId: string; moduleId: string },
    buildPatch: (current: ResolvedConfig) => ConfigPatch,
    action: string,
  ): Promise<ModuleState> {
    if (!request.guild?.canManage) throw ApiError.forbidden('You cannot manage this guild');
    const module = requireModule(moduleId);
    const current = await config.get(guildId, moduleId);

    const ifMatch = request.headers['if-match'];
    if (ifMatch && ifMatch !== '*' && ifMatch !== configEtag(current)) throw ApiError.preconditionFailed();

    const patch = buildPatch(current);
    if (module.alwaysEnabled && patch.enabled === false) {
      throw ApiError.badRequest('This module cannot be disabled', [{ path: ['enabled'], message: 'Always enabled' }]);
    }

    // Only a changed config is checked: a channel deleted in Discord meanwhile must not keep the module from being
    // switched on or off.
    const parsed = patch.config === undefined ? current.config : module.configSchema.parse(patch.config);
    if (module.validateConfig && JSON.stringify(parsed) !== JSON.stringify(current.config)) {
      const issues = module.validateConfig(parsed, await guildEntities(guildId));
      if (issues.length > 0) {
        throw ApiError.badRequest(
          'Config references unknown or unusable channels or roles',
          issues.map((issue) => ({ path: ['config', ...issue.path], message: issue.message })),
        );
      }
    }

    const userId = requireSession(request).userId;
    let updated: ResolvedConfig;
    try {
      // Validate the version used for merge and reference checks at the database write, too.
      updated = await config.update(guildId, moduleId, patch, userId, current.updatedAt);
    } catch (err) {
      if (err instanceof ConfigConflictError) throw ApiError.preconditionFailed();
      throw err;
    }
    const diff = {
      before: { enabled: current.enabled, config: current.config },
      after: { enabled: updated.enabled, config: updated.config },
    };
    await recordAudit(db, { guildId, userId, moduleId, action, diff });
    let applied = true;
    let applyError: string | null = null;
    if (module.onSaved) {
      try {
        await module.onSaved(moduleServices(deps, module), { guildId, userId, ...diff });
      } catch (err) {
        request.log.warn({ err, guildId, moduleId }, 'Module onSaved failed');
        applied = false;
        applyError = err instanceof Error ? err.message : String(err);
      }
    }
    if (module.onSaved || !current.applied || current.applyError) {
      await config.setApplied(guildId, moduleId, applied, applyError, updated.updatedAt);
    }
    updated.applied = applied;
    updated.applyError = applyError;

    reply.header('etag', configEtag(updated));
    return toState(moduleId, updated);
  }

  return async (app) => {
    app.get(
      '/v1/modules',
      {
        schema: {
          tags: ['modules'],
          summary: 'Module catalog',
          description: 'Names follow `Accept-Language`; `configSchema` is a JSON Schema for forms (omitted when compact=true).',
          security: [],
          querystring: z.object({ compact: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }),
          response: { 200: z.union([z.array(ModuleInfo), z.array(ModuleCatalogItem)]) },
        },
      },
      async (request) => {
        const locale = i18n.resolveLocale(request.headers['accept-language']?.split(',')[0]);
        const isCompact = request.query.compact === true;
        return registry.all().map((module) => {
          const item = {
            id: module.id,
            name: i18n.has(`${module.id}.name`, locale) ? i18n.t(locale, `${module.id}.name`) : module.id,
            alwaysEnabled: module.alwaysEnabled ?? false,
            enabledByDefault: module.enabledByDefault ?? false,
            vip: config.vip.isVipModule(module.id),
          };
          if (isCompact) return item;
          return {
            ...item,
            configSchema: z.toJSONSchema(module.configSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
          };
        });
      },
    );

    // Public module routes: only when the module is enabled in the guild.
    for (const module of registry.all()) {
      if (!module.publicApi) continue;
      const register = module.publicApi;
      await app.register(
        async (publicScope) => {
          publicScope.addHook('preHandler', async (request) => {
            const { guildId } = request.params as { guildId: string };
            if (!Snowflake.safeParse(guildId).success || !(await config.isEnabled(guildId, module.id))) {
              throw ApiError.notFound();
            }
          });
          await register(publicScope, moduleServices(deps, module));
        },
        { prefix: `/v1/public/guilds/:guildId/modules/${module.id}` },
      );
    }

    await app.register(async (guildScope) => {
      guildScope.addHook('preHandler', requireGuildAccess(userGuilds, 'moderator'));
      if (deps.options.rateLimitPerMinute > 0) guildScope.addHook('preHandler', guildWriteLimit(deps.redis));
      const scope = guildScope.withTypeProvider<ZodTypeProvider>();

      scope.get(
        '/v1/guilds/:guildId/modules',
        {
          schema: {
            tags: ['modules'],
            summary: 'State of all guild modules',
            params: GuildParams,
            querystring: z.object({ compact: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }),
            response: { 200: z.union([z.array(ModuleState), z.array(ModuleSummaryState)]) },
          },
        },
        async (request) => {
          const all = await config.getAll(request.params.guildId);
          const isCompact = request.query.compact === true;
          return registry.all().map((m) => {
            const resolved = all.get(m.id)!;
            return isCompact ? toSummaryState(m.id, resolved) : toState(m.id, resolved);
          });
        },
      );

      scope.get(
        '/v1/guilds/:guildId/modules/:moduleId',
        {
          schema: {
            tags: ['modules'],
            summary: 'Module state and config',
            description: "Returns an `ETag`; pass it in `If-Match` when writing so you don't overwrite someone else's changes.",
            params: ModuleParams,
            response: { 200: ModuleState },
          },
        },
        async (request, reply) => {
          const { guildId, moduleId } = request.params;
          requireModule(moduleId);
          const resolved = await config.get(guildId, moduleId);
          reply.header('etag', configEtag(resolved));
          return toState(moduleId, resolved);
        },
      );

      scope.put(
        '/v1/guilds/:guildId/modules/:moduleId',
        {
          schema: {
            tags: ['modules'],
            summary: 'Replace module config',
            params: ModuleParams,
            body: ModuleConfigReplace,
            response: { 200: ModuleState },
          },
        },
        (request, reply) =>
          applyUpdate(request, reply, request.params, () => ({ enabled: request.body.enabled, config: request.body.config }), 'module.update'),
      );

      scope.patch(
        '/v1/guilds/:guildId/modules/:moduleId',
        {
          schema: {
            tags: ['modules'],
            summary: 'Partially update the config or enable/disable the module',
            params: ModuleParams,
            body: ModuleConfigPatch,
            response: { 200: ModuleState },
          },
        },
        (request, reply) =>
          applyUpdate(
            request,
            reply,
            request.params,
            (current) => ({
              enabled: request.body.enabled,
              config: request.body.config ? { ...(current.config as object), ...request.body.config } : undefined,
            }),
            'module.update',
          ),
      );

      scope.post(
        '/v1/guilds/:guildId/modules/:moduleId/reset',
        {
          schema: { tags: ['modules'], summary: 'Reset config to defaults', params: ModuleParams, response: { 200: ModuleState } },
        },
        async (request, reply) => {
          const defaults = await config.defaults(request.params.guildId, request.params.moduleId);
          return applyUpdate(request, reply, request.params, () => ({ config: defaults }), 'module.reset');
        },
      );

      scope.post(
        '/v1/guilds/:guildId/modules/:moduleId/retry-apply',
        {
          schema: {
            tags: ['modules'],
            summary: 'Retry applying onSaved hook for the current configuration',
            params: ModuleParams,
            response: { 200: ModuleState },
          },
        },
        async (request, reply) => {
          if (!request.guild?.canManage) throw ApiError.forbidden('You cannot manage this guild');
          const { guildId, moduleId } = request.params;
          const module = requireModule(moduleId);
          return withApplyLock(guildId, moduleId, async () => {
            const current = await config.get(guildId, moduleId);
            reply.header('etag', configEtag(current));
            if (!module.onSaved) return toState(moduleId, current);
            // If already applied and no error, avoid re-running
            if (current.applied && !current.applyError) {
              return toState(moduleId, current);
            }

            const userId = requireSession(request).userId;
            const lastAudit = await db.dashboardAuditLog.findFirst({
              where: { guildId, moduleId, action: { in: ['module.update', 'module.reset'] } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            });
            const diff = (lastAudit?.diff as { before: { enabled: boolean; config: unknown }; after: { enabled: boolean; config: unknown } } | null) ?? {
              before: { enabled: false, config: {} },
              after: { enabled: current.enabled, config: current.config },
            };

            let applied = true;
            let applyError: string | null = null;
            try {
              await module.onSaved(moduleServices(deps, module), { guildId, userId, ...diff });
            } catch (err) {
              request.log.warn({ err, guildId, moduleId }, 'Module retry onSaved failed');
              applied = false;
              applyError = err instanceof Error ? err.message : String(err);
            }

            await config.setApplied(guildId, moduleId, applied, applyError, current.updatedAt);
            await recordAudit(db, {
              guildId,
              userId,
              moduleId,
              action: 'module.retry_apply',
              diff: {
                before: { applied: current.applied, applyError: current.applyError },
                after: { applied, applyError },
              },
            });

            const fresh = await config.get(guildId, moduleId);
            reply.header('etag', configEtag(fresh));
            return toState(moduleId, fresh);
          });
        },
      );

      const diagnoseModule = async (guildId: string, moduleId: string, customConfig?: unknown) => {
        const module = requireModule(moduleId);
        const issues: ModuleDiagnosticIssue[] = [];

        // 1. VIP dependency
        if (config.vipLocked(guildId, moduleId)) {
          issues.push({
            severity: 'error',
            message: 'This module requires Discord VIP to operate',
            action: 'Activate a VIP key on this server to enable and run this module',
          });
        }

        // 2. Validate current or custom config against guild snapshot
        const current = await config.get(guildId, moduleId);
        const configToValidate = module.configSchema.parse(customConfig !== undefined ? customConfig : current.config);
        const entities = await guildEntities(guildId);
        if (module.validateConfig) {
          const rawIssues = module.validateConfig(configToValidate, entities);
          for (const issue of rawIssues) {
            issues.push({
              severity: issue.severity ?? 'error',
              field: issue.path.join('.'),
              message: issue.message,
              action: issue.action ?? 'Update module settings with a valid channel or role',
            });
          }
        }

        return {
          valid: issues.every((i) => i.severity !== 'error'),
          issues,
        };
      };

      scope.get(
        '/v1/guilds/:guildId/modules/:moduleId/diagnose',
        {
          schema: {
            tags: ['modules'],
            summary: 'Diagnose module configuration, permissions and dependencies',
            description: 'Checks if required channels and roles exist, if the bot can send messages or assign roles, and if VIP is active.',
            params: ModuleParams,
            response: { 200: ModuleDiagnosticResult },
          },
        },
        async (request) => diagnoseModule(request.params.guildId, request.params.moduleId),
      );

      scope.post(
        '/v1/guilds/:guildId/modules/:moduleId/diagnose',
        {
          schema: {
            tags: ['modules'],
            summary: 'Diagnose draft module configuration',
            description: 'Validates a draft configuration before saving against permissions and dependencies.',
            params: ModuleParams,
            body: z.object({ config: z.unknown().optional() }),
            response: { 200: ModuleDiagnosticResult },
          },
        },
        async (request) => diagnoseModule(request.params.guildId, request.params.moduleId, request.body.config),
      );

      // Modules' own routes: /v1/guilds/:guildId/modules/<id>/…
      for (const module of registry.all()) {
        if (!module.api) continue;
        const register = module.api;
        await guildScope.register(
          async (moduleScope) => {
            moduleScope.addHook('preHandler', async (request) => {
              const reading = request.method === 'GET' || request.method === 'HEAD';
              if (!reading && module.id !== 'moderation' && module.id !== 'music' && !request.guild?.canManage) {
                throw ApiError.forbidden('You cannot manage this guild');
              }
            });
            await register(moduleScope, {
              ...moduleServices(deps, module),
              currentUserId: (request) => requireSession(request).userId,
              guildEntities,
              requireEnabled: async (guildId) => {
                if (await config.isEnabled(guildId, module.id)) return;
                throw config.vipLocked(guildId, module.id) ? HttpError.vipRequired(module.id) : HttpError.moduleDisabled(module.id);
              },
            });
          },
          { prefix: `/v1/guilds/:guildId/modules/${module.id}` },
        );
      }
    });
  };
}
