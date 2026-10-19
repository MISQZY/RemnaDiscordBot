import { ModuleConfigPatch, ModuleConfigReplace, ModuleId, ModuleInfo, ModuleState, Snowflake } from '@bot/contracts';
import { moduleServices, UnknownModuleError, type AnyModule, type ConfigPatch, type ResolvedConfig } from '@bot/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { recordAudit } from '../audit.js';
import type { UserGuildService } from '../auth/user-guilds.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';
import { requireGuildAccess } from '../plugins/guild-access.js';
import { GUILD_WRITE_LIMIT } from '../plugins/rate-limit.js';
import { requireSession } from '../plugins/session.js';

const GuildParams = z.object({ guildId: Snowflake });
const ModuleParams = GuildParams.extend({ moduleId: ModuleId });

/** ETag конфига: меняется при каждом сохранении. */
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

  /** Общий путь записи: If-Match → валидация и сохранение → аудит → новый ETag. */
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

    if (module.validateConfig) {
      const parsed = module.configSchema.parse(patch.config ?? current.config);
      const issues = module.validateConfig(parsed, await guildEntities(guildId));
      if (issues.length > 0) {
        throw ApiError.badRequest(
          'Config references unknown or unusable channels or roles',
          issues.map((issue) => ({ path: ['config', ...issue.path], message: issue.message })),
        );
      }
    }

    const updated = await config.update(guildId, moduleId, patch, requireSession(request).userId);
    await recordAudit(db, {
      guildId,
      userId: requireSession(request).userId,
      moduleId,
      action,
      diff: {
        before: { enabled: current.enabled, config: current.config },
        after: { enabled: updated.enabled, config: updated.config },
      },
    });

    reply.header('etag', configEtag(updated));
    return toState(moduleId, updated);
  }

  return async (app) => {
    app.get(
      '/v1/modules',
      {
        schema: {
          tags: ['modules'],
          summary: 'Каталог модулей',
          description: 'Имена — на языке из `Accept-Language`; `configSchema` — JSON Schema для форм.',
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
          configSchema: z.toJSONSchema(module.configSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
        }));
      },
    );

    // Публичные роуты модулей: только если модуль включён в гильдии.
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
      const scope = guildScope.withTypeProvider<ZodTypeProvider>();

      scope.get(
        '/v1/guilds/:guildId/modules',
        { schema: { tags: ['modules'], summary: 'Состояние всех модулей гильдии', params: GuildParams, response: { 200: z.array(ModuleState) } } },
        async (request) =>
          Promise.all(registry.all().map(async (m) => toState(m.id, await config.get(request.params.guildId, m.id)))),
      );

      scope.get(
        '/v1/guilds/:guildId/modules/:moduleId',
        {
          schema: {
            tags: ['modules'],
            summary: 'Состояние и конфиг модуля',
            description: 'Возвращает `ETag`; передайте его в `If-Match` при записи, чтобы не затереть чужие изменения.',
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
            summary: 'Заменить конфиг модуля',
            params: ModuleParams,
            body: ModuleConfigReplace,
            response: { 200: ModuleState },
          },
          config: { rateLimit: GUILD_WRITE_LIMIT },
        },
        (request, reply) =>
          applyUpdate(request, reply, request.params, () => ({ enabled: request.body.enabled, config: request.body.config }), 'module.update'),
      );

      scope.patch(
        '/v1/guilds/:guildId/modules/:moduleId',
        {
          schema: {
            tags: ['modules'],
            summary: 'Частично изменить конфиг или включить/выключить модуль',
            params: ModuleParams,
            body: ModuleConfigPatch,
            response: { 200: ModuleState },
          },
          config: { rateLimit: GUILD_WRITE_LIMIT },
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
          schema: { tags: ['modules'], summary: 'Сбросить конфиг к значениям по умолчанию', params: ModuleParams, response: { 200: ModuleState } },
          config: { rateLimit: GUILD_WRITE_LIMIT },
        },
        async (request, reply) => {
          const defaults = await config.defaults(request.params.guildId, request.params.moduleId);
          return applyUpdate(request, reply, request.params, () => ({ config: defaults }), 'module.reset');
        },
      );

      // Собственные роуты модулей: /v1/guilds/:guildId/modules/<id>/…
      for (const module of registry.all()) {
        if (!module.api) continue;
        const register = module.api;
        await guildScope.register(
          async (moduleScope) => {
            await register(moduleScope, {
              ...moduleServices(deps, module),
              currentUserId: (request) => requireSession(request).userId,
              guildEntities,
            });
          },
          { prefix: `/v1/guilds/:guildId/modules/${module.id}` },
        );
      }
    });
  };
}
