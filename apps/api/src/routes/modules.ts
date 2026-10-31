import { ModuleConfigPatch, ModuleConfigReplace, ModuleId, ModuleInfo, ModuleState, Snowflake } from '@bot/contracts';
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
  return { id, enabled: resolved.enabled, config: resolved.config, updatedAt: resolved.updatedAt };
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

  /** Common write path: If-Match → validation and save → audit → new ETag. */
  async function applyUpdate(
    request: FastifyRequest,
    reply: FastifyReply,
    { guildId, moduleId }: { guildId: string; moduleId: string },
    buildPatch: (current: ResolvedConfig) => ConfigPatch,
    action: string,
  ): Promise<ModuleState> {
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
    if (module.onSaved) {
      try {
        await module.onSaved(moduleServices(deps, module), { guildId, userId, ...diff });
      } catch (err) {
        request.log.warn({ err, guildId, moduleId }, 'Module onSaved failed');
      }
    }

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
          description: 'Names follow `Accept-Language`; `configSchema` is a JSON Schema for forms.',
          security: [],
          response: { 200: z.array(ModuleInfo) },
        },
      },
      async (request) => {
        const locale = i18n.resolveLocale(request.headers['accept-language']?.split(',')[0]);
        return registry.all().map((module) => ({
          id: module.id,
          name: i18n.has(`${module.id}.name`, locale) ? i18n.t(locale, `${module.id}.name`) : module.id,
          alwaysEnabled: module.alwaysEnabled ?? false,
          enabledByDefault: module.enabledByDefault ?? false,
          vip: config.vip.isVipModule(module.id),
          configSchema: z.toJSONSchema(module.configSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
        }));
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
      guildScope.addHook('preHandler', requireGuildAccess(userGuilds));
      if (deps.options.rateLimitPerMinute > 0) guildScope.addHook('preHandler', guildWriteLimit(deps.redis));
      const scope = guildScope.withTypeProvider<ZodTypeProvider>();

      scope.get(
        '/v1/guilds/:guildId/modules',
        { schema: { tags: ['modules'], summary: 'State of all guild modules', params: GuildParams, response: { 200: z.array(ModuleState) } } },
        async (request) => {
          const all = await config.getAll(request.params.guildId);
          return registry.all().map((m) => toState(m.id, all.get(m.id)!));
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

      // Modules' own routes: /v1/guilds/:guildId/modules/<id>/…
      for (const module of registry.all()) {
        if (!module.api) continue;
        const register = module.api;
        await guildScope.register(
          async (moduleScope) => {
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
