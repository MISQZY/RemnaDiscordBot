import {
  AuditLogPage,
  GuildChannel,
  GuildEmoji,
  GuildOverview,
  GuildRole,
  GuildSettings,
  GuildSettingsPatch,
  Snowflake,
} from '@bot/contracts';
import { publishConfigInvalidation } from '@bot/core';
import type { PrismaClient } from '@bot/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { recordAudit } from '../audit.js';
import type { UserGuildService } from '../auth/user-guilds.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';
import { requireGuildAccess } from '../plugins/guild-access.js';
import { GUILD_WRITE_LIMIT, guildWriteLimit } from '../plugins/rate-limit.js';
import { requireSession } from '../plugins/session.js';

const GuildParams = z.object({ guildId: Snowflake });

export function guildSettingsEtag(updatedAt: Date | string | null | undefined): string {
  if (!updatedAt) return '"default"';
  return `"${typeof updatedAt === 'string' ? updatedAt : updatedAt.toISOString()}"`;
}

async function readSettings(db: PrismaClient, guildId: string): Promise<{ settings: GuildSettings; updatedAt: Date | null }> {
  const guild = await db.guild.findUnique({ where: { id: guildId } });
  const modRoleIds = z.array(Snowflake).safeParse(guild?.modRoleIds);
  return {
    settings: {
      locale: guild?.locale === 'en' ? 'en' : 'ru',
      timezone: guild?.timezone ?? 'Europe/Moscow',
      modRoleIds: modRoleIds.success ? modRoleIds.data : [],
      updatedAt: guild?.updatedAt?.toISOString() ?? null,
    },
    updatedAt: guild?.updatedAt ?? null,
  };
}

export function guildRoutes({ db, redis, snapshots, guildLocales, config, options }: ApiDeps, userGuilds: UserGuildService): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireGuildAccess(userGuilds));
    if (options.rateLimitPerMinute > 0) app.addHook('preHandler', guildWriteLimit(redis));

    app.get(
      '/v1/guilds/:guildId',
      { schema: { tags: ['guilds'], summary: 'Guild and its general settings', params: GuildParams, response: { 200: GuildOverview } } },
      async (request, reply) => {
        const { guildId } = request.params;
        const meta = await snapshots.getMeta(guildId);
        if (!meta) throw ApiError.botNotInGuild();
        const { settings, updatedAt } = await readSettings(db, guildId);
        reply.header('etag', guildSettingsEtag(updatedAt));
        return { meta, settings, vip: config.vip.of(guildId) };
      },
    );

    app.patch(
      '/v1/guilds/:guildId',
      {
        schema: {
          tags: ['guilds'],
          summary: 'Update general guild settings',
          params: GuildParams,
          body: GuildSettingsPatch,
          response: { 200: GuildSettings },
        },
        config: { rateLimit: GUILD_WRITE_LIMIT },
      },
      async (request, reply) => {
        const { guildId } = request.params;
        const patch = request.body;
        const ifMatch = request.headers['if-match'];

        if (patch.modRoleIds) {
          const roles = new Set((await snapshots.getRoles(guildId))?.map((role) => role.id));
          const unknown = patch.modRoleIds.filter((id) => !roles.has(id));
          if (unknown.length > 0) {
            throw ApiError.badRequest(
              'Unknown roles',
              unknown.map((id) => ({ path: ['modRoleIds', patch.modRoleIds!.indexOf(id)], message: `Role ${id} not found` })),
            );
          }
        }

        const { settings: before, updatedAt: currentUpdatedAt } = await readSettings(db, guildId);
        const currentEtag = guildSettingsEtag(currentUpdatedAt);
        if (ifMatch && ifMatch !== '*' && ifMatch !== currentEtag) {
          throw ApiError.preconditionFailed();
        }

        const after = {
          locale: patch.locale ?? before.locale,
          timezone: patch.timezone ?? before.timezone,
          modRoleIds: patch.modRoleIds ?? before.modRoleIds,
        };

        const updatedGuild = await db.$transaction(async (tx) => {
          const newUpdatedAt = new Date(Math.max(Date.now(), currentUpdatedAt ? currentUpdatedAt.getTime() + 1 : 0));
          if (currentUpdatedAt === null) {
            return await tx.guild.upsert({
              where: { id: guildId },
              create: { id: guildId, ...after, updatedAt: newUpdatedAt },
              update: { ...after, updatedAt: newUpdatedAt },
            });
          }

          const { count } = await tx.guild.updateMany({
            where: { id: guildId, updatedAt: currentUpdatedAt },
            data: { ...after, updatedAt: newUpdatedAt },
          });
          if (count !== 1) throw ApiError.preconditionFailed();

          return await tx.guild.findUniqueOrThrow({ where: { id: guildId } });
        });

        const resultSettings: GuildSettings = {
          locale: updatedGuild.locale === 'en' ? 'en' : 'ru',
          timezone: updatedGuild.timezone,
          modRoleIds: z.array(Snowflake).safeParse(updatedGuild.modRoleIds).data ?? [],
          updatedAt: updatedGuild.updatedAt.toISOString(),
        };

        // All processes read the language and other general settings — invalidate their caches.
        guildLocales.invalidate(guildId);
        await publishConfigInvalidation(redis, { guildId });
        await recordAudit(db, {
          guildId,
          userId: requireSession(request).userId,
          action: 'guild.update',
          diff: { before, after: resultSettings },
        });

        reply.header('etag', guildSettingsEtag(updatedGuild.updatedAt));
        return resultSettings;
      },
    );

    app.get(
      '/v1/guilds/:guildId/channels',
      { schema: { tags: ['guilds'], summary: 'Guild channels', params: GuildParams, response: { 200: z.array(GuildChannel) } } },
      async (request) => (await snapshots.getChannels(request.params.guildId)) ?? [],
    );

    app.get(
      '/v1/guilds/:guildId/roles',
      {
        schema: {
          tags: ['guilds'],
          summary: 'Guild roles',
          description: "`manageable` — the role is below the bot's role, so the bot can assign it.",
          params: GuildParams,
          response: { 200: z.array(GuildRole) },
        },
      },
      async (request) => (await snapshots.getRoles(request.params.guildId)) ?? [],
    );

    app.get(
      '/v1/guilds/:guildId/emojis',
      { schema: { tags: ['guilds'], summary: 'Guild emojis', params: GuildParams, response: { 200: z.array(GuildEmoji) } } },
      async (request) => (await snapshots.getEmojis(request.params.guildId)) ?? [],
    );

    app.get(
      '/v1/guilds/:guildId/audit',
      {
        schema: {
          tags: ['guilds'],
          summary: 'Dashboard change history',
          params: GuildParams,
          querystring: z.object({
            limit: z.coerce.number().int().min(1).max(100).default(50),
            cursor: z.string().optional(),
          }),
          response: { 200: AuditLogPage },
        },
      },
      async (request) => {
        const { limit, cursor } = request.query;
        const rows = await db.dashboardAuditLog.findMany({
          where: { guildId: request.params.guildId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const items = rows.slice(0, limit);
        return {
          items: items.map((row) => ({
            id: row.id,
            userId: row.userId,
            moduleId: row.moduleId,
            action: row.action,
            diff: row.diff,
            createdAt: row.createdAt.toISOString(),
          })),
          nextCursor: rows.length > limit ? items.at(-1)!.id : null,
        };
      },
    );
  };
}
