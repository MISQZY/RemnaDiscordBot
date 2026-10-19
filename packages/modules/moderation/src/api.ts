import { HttpError, type ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CaseType, ModCaseDto, toCaseDto, type ModerationConfig } from './config.js';
import { ModerationService } from './service.js';

const CaseParams = z.object({ guildId: z.string(), number: z.coerce.number().int().min(1) });
const CasesQuery = z.object({
  targetId: z.string().optional(),
  type: CaseType.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Case number to continue from (exclusive) — cases go from newest to oldest. */
  before: z.coerce.number().int().optional(),
});
const CasesPage = z.object({ items: z.array(ModCaseDto), nextBefore: z.number().int().nullable() });

export function moderationApi(app: FastifyInstance, ctx: ApiModuleContext<ModerationConfig>): void {
  const service = new ModerationService(ctx);
  const guildId = (request: FastifyRequest) => (request.params as { guildId: string }).guildId;

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
      return { items: items.map(toCaseDto), nextBefore: rows.length > limit ? items.at(-1)!.number : null };
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

  app.get(
    '/users/:userId/warnings',
    {
      schema: {
        tags: ['moderation'],
        summary: "Member's active warnings",
        params: z.object({ guildId: z.string(), userId: z.string() }),
        response: { 200: z.array(ModCaseDto) },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string };
      return (await service.activeWarnings(guildId(request), userId)).map(toCaseDto);
    },
  );
}
