import { HttpError, type ApiModuleContext, type ModuleServices } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LeaderboardEntry, toEntry, type LevelingConfig } from './config.js';
import { LevelingService } from './service.js';

const LeaderboardQuery = z.object({
  page: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const LeaderboardPage = z.object({ items: z.array(LeaderboardEntry), total: z.number().int() });
const MemberParams = z.object({ guildId: z.string(), userId: z.string() });

const guildId = (request: FastifyRequest) => (request.params as { guildId: string }).guildId;

function leaderboardRoute(app: FastifyInstance, service: LevelingService, guard?: (guildId: string) => Promise<void>) {
  app.get(
    '/leaderboard',
    { schema: { tags: ['leveling'], summary: 'Лидерборд по опыту', querystring: LeaderboardQuery, response: { 200: LeaderboardPage } } },
    async (request) => {
      await guard?.(guildId(request));
      const { page, limit } = request.query as z.infer<typeof LeaderboardQuery>;
      return service.leaderboard(guildId(request), page, limit);
    },
  );
}

export function levelingApi(app: FastifyInstance, ctx: ApiModuleContext<LevelingConfig>): void {
  const service = new LevelingService(ctx.db);
  leaderboardRoute(app, service);

  async function memberEntry(request: FastifyRequest) {
    const { userId } = request.params as { userId: string };
    const row = await service.get(guildId(request), userId);
    if (!row) throw HttpError.notFound('Member has no XP');
    return toEntry(row, await service.rankOf(row.guildId, row.xp));
  }

  app.get(
    '/members/:userId',
    { schema: { tags: ['leveling'], summary: 'Опыт и место участника', params: MemberParams, response: { 200: LeaderboardEntry } } },
    memberEntry,
  );

  app.patch(
    '/members/:userId',
    {
      schema: {
        tags: ['leveling'],
        summary: 'Установить опыт участника',
        description: 'Уровень пересчитывается; роли-награды выдаются при следующем сообщении участника.',
        params: MemberParams,
        body: z.object({ xp: z.number().int().min(0).max(10_000_000) }),
        response: { 200: LeaderboardEntry },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string };
      await service.setXp(guildId(request), userId, (request.body as { xp: number }).xp);
      return memberEntry(request);
    },
  );

  app.post(
    '/reset',
    {
      schema: {
        tags: ['leveling'],
        summary: 'Сбросить опыт всех участников',
        body: z.object({ confirm: z.literal(true) }),
        response: { 200: z.object({ deleted: z.number().int() }) },
      },
    },
    async (request) => ({ deleted: await service.reset(guildId(request)) }),
  );
}

/** Public leaderboard — when allowed in the settings. */
export function levelingPublicApi(app: FastifyInstance, ctx: ModuleServices<LevelingConfig>): void {
  leaderboardRoute(app, new LevelingService(ctx.db), async (id) => {
    if (!(await ctx.getConfig(id)).publicLeaderboard) throw HttpError.notFound();
  });
}
