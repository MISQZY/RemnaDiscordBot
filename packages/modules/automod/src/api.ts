import { Snowflake } from '@bot/contracts';
import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import { DiscordAPIError, Routes, type APIAutoModerationRule } from 'discord.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AutomodConfig } from './config.js';
import { fromDiscord, NativeRule, NativeRuleInput, toDiscord } from './native.js';
import { endRaid, raidKey } from './raid.js';

const RuleParams = z.object({ guildId: Snowflake, ruleId: Snowflake });

/** Discord's refusal (missing Manage Server, a bad regex, too many rules) as a 400 with its message. */
async function discord<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof DiscordAPIError && err.status < 500) throw HttpError.badRequest(err.message);
    throw err;
  }
}

export function automodApi(app: FastifyInstance, ctx: ApiModuleContext<AutomodConfig>): void {
  const guildId = (request: FastifyRequest) => (request.params as { guildId: string }).guildId;
  const ruleId = (request: FastifyRequest) => (request.params as { ruleId: string }).ruleId;

  async function validate(id: string, input: NativeRuleInput): Promise<void> {
    const checker = new EntityChecker(await ctx.guildEntities(id))
      .textChannel(input.alertChannelId, ['alertChannelId'])
      .roles(input.exemptRoleIds, ['exemptRoleIds'])
      .channels(input.exemptChannelIds, ['exemptChannelIds']);
    if (checker.issues.length > 0) throw HttpError.badRequest('Rule references unknown channels or roles', checker.issues);
  }

  app.get(
    '/native-rules',
    { schema: { tags: ['automod'], summary: "Discord's AutoMod rules of the server (message rules only)", response: { 200: z.array(NativeRule) } } },
    async (request) => {
      const rules = (await discord(() => ctx.rest.get(Routes.guildAutoModerationRules(guildId(request))))) as APIAutoModerationRule[];
      return rules.map(fromDiscord).filter((r) => r !== null);
    },
  );

  app.post(
    '/native-rules',
    { schema: { tags: ['automod'], summary: 'Create an AutoMod rule in Discord', body: NativeRuleInput, response: { 201: NativeRule } } },
    async (request, reply) => {
      const input = request.body as NativeRuleInput;
      await validate(guildId(request), input);
      const created = (await discord(() =>
        ctx.rest.post(Routes.guildAutoModerationRules(guildId(request)), { body: toDiscord(input, { create: true }), reason: `Dashboard: ${ctx.currentUserId(request)}` }),
      )) as APIAutoModerationRule;
      return reply.status(201).send(fromDiscord(created));
    },
  );

  app.put(
    '/native-rules/:ruleId',
    {
      schema: {
        tags: ['automod'],
        summary: 'Update an AutoMod rule; its trigger type cannot change',
        params: RuleParams,
        body: NativeRuleInput,
        response: { 200: NativeRule },
      },
    },
    async (request) => {
      const input = request.body as NativeRuleInput;
      await validate(guildId(request), input);
      const route = Routes.guildAutoModerationRule(guildId(request), ruleId(request));
      const current = fromDiscord((await discord(() => ctx.rest.get(route))) as APIAutoModerationRule);
      if (current && current.trigger.type !== input.trigger.type) throw HttpError.badRequest('The trigger type of a rule cannot change', [{ path: ['trigger', 'type'], message: 'Fixed' }]);
      const updated = (await discord(() => ctx.rest.patch(route, { body: toDiscord(input, { create: false }), reason: `Dashboard: ${ctx.currentUserId(request)}` }))) as APIAutoModerationRule;
      return fromDiscord(updated);
    },
  );

  app.delete(
    '/native-rules/:ruleId',
    { schema: { tags: ['automod'], summary: 'Delete an AutoMod rule', params: RuleParams, response: { 204: z.null() } } },
    async (request, reply) => {
      await discord(() => ctx.rest.delete(Routes.guildAutoModerationRule(guildId(request), ruleId(request)), { reason: `Dashboard: ${ctx.currentUserId(request)}` }));
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/raid',
    { schema: { tags: ['automod'], summary: 'Whether raid mode is on and until when', response: { 200: z.object({ active: z.boolean(), endsAt: z.iso.datetime().nullable() }) } } },
    async (request) => {
      const until = await ctx.redis.get(raidKey(guildId(request)));
      return { active: until !== null, endsAt: until ? new Date(Number(until)).toISOString() : null };
    },
  );

  app.post(
    '/raid/end',
    { schema: { tags: ['automod'], summary: 'End raid mode: unlock its channels and resume invites', response: { 200: z.object({ ended: z.boolean() }) } } },
    async (request) => ({ ended: await endRaid(ctx, guildId(request)) }),
  );
}
