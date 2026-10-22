import { Snowflake } from '@bot/contracts';
import { defineModule, EntityChecker } from '@bot/core';
import { UserDirectory, UserInfo } from '@bot/discord';
import { z } from 'zod';
import { suggestCommand, suggestionCommand, voteComponent } from './bot.js';
import { defaultSuggestionsConfig, SuggestionDto, SuggestionsConfig, SuggestionStatus } from './config.js';
import { locales } from './locales.js';
import { PREFIX, SuggestionService, toSuggestionDto } from './service.js';

export { SuggestionDto, SuggestionsConfig, SuggestionStatus } from './config.js';

/** Members suggest with /suggest, everyone votes, reviewers decide; the author hears back. */
export default defineModule({
  id: 'suggestions',
  configSchema: SuggestionsConfig,
  defaultConfig: defaultSuggestionsConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) => new EntityChecker(guild).textChannel(config.channelId, ['channelId']).roles(config.reviewerRoleIds, ['reviewerRoleIds']).issues,
  bot: {
    commands: [suggestCommand, suggestionCommand],
    components: { [PREFIX]: voteComponent },
  },
  api: (app, ctx) => {
    const service = new SuggestionService(ctx);
    const users = new UserDirectory(ctx.redis, ctx.rest);
    const guildId = (request: { params: unknown }) => (request.params as { guildId: string }).guildId;
    const Query = z.object({ status: SuggestionStatus.optional(), before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });

    app.get(
      '/suggestions',
      {
        schema: {
          tags: ['suggestions'],
          summary: 'Suggestions, newest first',
          querystring: Query,
          response: { 200: z.object({ items: z.array(SuggestionDto), nextBefore: z.number().int().nullable(), users: z.record(z.string(), UserInfo) }) },
        },
      },
      async (request) => {
        const { status, before, limit } = request.query as z.infer<typeof Query>;
        const rows = await ctx.db.suggestion.findMany({
          where: { guildId: guildId(request), status, ...(before ? { number: { lt: before } } : {}) },
          orderBy: { number: 'desc' },
          take: limit + 1,
        });
        const items = rows.slice(0, limit);
        return {
          items: items.map(toSuggestionDto),
          nextBefore: rows.length > limit ? items.at(-1)!.number : null,
          users: await users.resolve(items.flatMap((s) => [s.authorId, s.reviewerId])),
        };
      },
    );

    app.post(
      '/suggestions/:number/status',
      {
        schema: {
          tags: ['suggestions'],
          summary: 'Decide on a suggestion',
          params: z.object({ guildId: Snowflake, number: z.coerce.number().int().min(1) }),
          body: z.object({ status: SuggestionStatus, response: z.string().max(1000).nullable().default(null) }),
          response: { 200: SuggestionDto },
        },
      },
      async (request) => {
        const { number } = request.params as { number: number };
        const { status, response } = request.body as { status: SuggestionStatus; response: string | null };
        const id = guildId(request);
        return toSuggestionDto(await service.decide(id, Number(number), status, ctx.currentUserId(request), response, await ctx.getConfig(id)));
      },
    );
  },
});
