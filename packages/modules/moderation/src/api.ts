import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import { UserDirectory, UserInfo } from '@bot/discord';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Snowflake } from '@bot/contracts';
import { CaseType, ModCaseDto, toCaseDto, type ModerationConfig } from './config.js';
import { LockdownService } from './lockdown.js';
import { ModerationService } from './service.js';

const LockedChannel = z.object({ channelId: Snowflake, endsAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime() });
const LockBody = z.object({
  /** `null` — a server lockdown: the channels from the settings or every public one. */
  channelIds: z.array(Snowflake).min(1).max(100).nullable(),
  durationSec: z.number().int().min(60).max(30 * 86_400).nullable().default(null),
  reason: z.string().max(300).nullable().default(null),
});
const LockAnswer = z.object({ locked: z.array(Snowflake), skipped: z.array(Snowflake), failed: z.array(Snowflake) });

const CaseParams = z.object({ guildId: Snowflake, number: z.coerce.number().int().min(1) });
const CasesQuery = z.object({
  targetId: Snowflake.optional(),
  type: CaseType.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Case number to continue from (exclusive) — cases go from newest to oldest. */
  before: z.coerce.number().int().optional(),
});
const CasesPage = z.object({
  items: z.array(ModCaseDto),
  nextBefore: z.number().int().nullable(),
  /** Names of the members, moderators and revokers of the page by ID — those Discord gave. */
  users: z.record(z.string(), UserInfo),
});

export function moderationApi(app: FastifyInstance, ctx: ApiModuleContext<ModerationConfig>): void {
  const service = new ModerationService(ctx);
  const users = new UserDirectory(ctx.redis, ctx.rest);
  const guildId = (request: FastifyRequest) => (request.params as { guildId: string }).guildId;

  /** Lockdown goes through Discord as the bot: only channels of this guild, never ones of another it is on. */
  async function ownChannels(id: string, channelIds: readonly string[] | null): Promise<void> {
    if (!channelIds) return;
    const { issues } = new EntityChecker(await ctx.guildEntities(id)).channels(channelIds, ['channelIds']);
    if (issues.length > 0) throw HttpError.badRequest('Unknown channels', issues);
  }

  async function findCase(request: FastifyRequest) {
    const { number } = CaseParams.parse(request.params);
    const modCase = await ctx.db.modCase.findUnique({ where: { guildId_number: { guildId: guildId(request), number } } });
    if (!modCase) throw HttpError.notFound('Case not found');
    return modCase;
  }

  app.get(
    '/cases',
    { schema: { tags: ['moderation'], summary: 'Moderation cases, newest first', querystring: CasesQuery, response: { 200: CasesPage } } },
    async (request) => {
      const { targetId, type, limit, before } = request.query as z.infer<typeof CasesQuery>;
      const rows = await ctx.db.modCase.findMany({
        where: { guildId: guildId(request), targetId, type, ...(before ? { number: { lt: before } } : {}) },
        orderBy: { number: 'desc' },
        take: limit + 1,
      });
      const items = rows.slice(0, limit);
      return {
        items: items.map(toCaseDto),
        nextBefore: rows.length > limit ? items.at(-1)!.number : null,
        users: await users.resolve(items.flatMap((c) => [c.targetId, c.moderatorId, c.revokedBy])),
      };
    },
  );

  app.get(
    '/cases/:number',
    { schema: { tags: ['moderation'], summary: 'Case by number', params: CaseParams, response: { 200: ModCaseDto } } },
    async (request) => toCaseDto(await findCase(request)),
  );

  app.patch(
    '/cases/:number',
    {
      schema: {
        tags: ['moderation'],
        summary: 'Update the case reason',
        params: CaseParams,
        body: z.object({ reason: z.string().max(500).nullable() }),
        response: { 200: ModCaseDto },
      },
    },
    async (request) => {
      const modCase = await findCase(request);
      const { reason } = request.body as { reason: string | null };
      return toCaseDto(await ctx.db.modCase.update({ where: { id: modCase.id }, data: { reason } }));
    },
  );

  app.post(
    '/cases/:number/revoke',
    {
      schema: {
        tags: ['moderation'],
        summary: 'Revoke a punishment early (unban, unmute or warning removal)',
        params: CaseParams,
        body: z.object({ reason: z.string().max(500).nullable().default(null) }),
        response: { 200: ModCaseDto },
      },
    },
    async (request) => {
      const modCase = await findCase(request);
      const { reason } = request.body as { reason: string | null };
      const config = await ctx.getConfig(modCase.guildId);
      return toCaseDto(await service.revoke(modCase.guildId, modCase.number, ctx.currentUserId(request), reason, config));
    },
  );

  app.post(
    '/notes',
    {
      schema: {
        tags: ['moderation'],
        summary: 'Add a note about a member to their history',
        body: z.object({ targetId: Snowflake, text: z.string().min(1).max(500) }),
        response: { 201: ModCaseDto },
      },
    },
    async (request, reply) => {
      const { targetId, text } = request.body as { targetId: string; text: string };
      const config = await ctx.getConfig(guildId(request));
      const modCase = await service.note({ guildId: guildId(request), targetId, moderatorId: ctx.currentUserId(request), reason: text }, config);
      return reply.status(201).send(toCaseDto(modCase));
    },
  );

  const lockdown = new LockdownService(ctx);

  app.get(
    '/lockdown',
    { schema: { tags: ['moderation'], summary: 'Channels locked by the bot', response: { 200: z.array(LockedChannel) } } },
    async (request) =>
      (await lockdown.locked(guildId(request))).map((r) => ({ channelId: r.channelId, endsAt: r.endsAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })),
  );

  app.post(
    '/lockdown',
    {
      schema: {
        tags: ['moderation'],
        summary: 'Lock channels: @everyone cannot write until unlocked or the duration ends',
        body: LockBody,
        response: { 200: LockAnswer },
      },
    },
    async (request) => {
      const id = guildId(request);
      const { channelIds, durationSec, reason } = request.body as z.infer<typeof LockBody>;
      await ownChannels(id, channelIds);
      const config = await ctx.getConfig(id);
      const targets = channelIds ?? (config.lockdown.channelIds.length > 0 ? config.lockdown.channelIds : await lockdown.serverChannels(id));
      return lockdown.lock(id, targets, {
        reason: `Lockdown from the dashboard by ${ctx.currentUserId(request)}: ${reason ?? '—'}`.slice(0, 512),
        until: durationSec ? new Date(Date.now() + durationSec * 1000) : null,
        scope: channelIds?.length === 1 ? channelIds[0]! : 'server',
      });
    },
  );

  app.post(
    '/unlock',
    {
      schema: {
        tags: ['moderation'],
        summary: 'Unlock channels; null — every channel the bot locked',
        body: z.object({ channelIds: z.array(Snowflake).min(1).max(100).nullable() }),
        response: { 200: z.object({ unlocked: z.array(Snowflake) }) },
      },
    },
    async (request) => {
      const { channelIds } = request.body as { channelIds: string[] | null };
      await ownChannels(guildId(request), channelIds);
      const unlocked = await lockdown.unlock(guildId(request), channelIds, {
        reason: `Unlock from the dashboard by ${ctx.currentUserId(request)}`,
        scope: channelIds?.length === 1 ? channelIds[0] : undefined,
      });
      return { unlocked };
    },
  );

  app.get(
    '/users/:userId/warnings',
    {
      schema: {
        tags: ['moderation'],
        summary: "Member's active warnings",
        params: z.object({ guildId: Snowflake, userId: Snowflake }),
        response: { 200: z.array(ModCaseDto) },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string };
      return (await service.activeWarnings(guildId(request), userId)).map(toCaseDto);
    },
  );
}
