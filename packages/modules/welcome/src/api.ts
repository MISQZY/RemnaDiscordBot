import type { ApiModuleContext } from '@bot/core';
import { renderMessage, toRestMessage, userVars, guildVars } from '@bot/templates';
import { DiscordAPIError, Routes, type REST } from 'discord.js';
import type { APIGuild, APIGuildMember, APIDMChannel } from 'discord.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WelcomeKind, type WelcomeConfig } from './config.js';

const TestBody = z.object({ kind: WelcomeKind });
const TestResult = z.object({ sent: z.boolean(), reason: z.string().optional() });
type TestResult = z.infer<typeof TestResult>;

/** Test send from the web app via Discord REST — as the user who clicked the button. */
export async function sendTestMessage(
  rest: REST,
  config: WelcomeConfig,
  { guildId, userId, kind }: { guildId: string; userId: string; kind: WelcomeKind },
): Promise<TestResult> {
  const settings = kind === 'join' ? config.join : kind === 'leave' ? config.leave : config.joinDm;
  const channelId = kind === 'join' ? config.join.channelId : kind === 'leave' ? config.leave.channelId : null;
  if (kind !== 'dm' && !channelId) return { sent: false, reason: 'Channel is not configured' };

  const [member, guild] = await Promise.all([
    rest.get(Routes.guildMember(guildId, userId)) as Promise<APIGuildMember>,
    rest.get(Routes.guild(guildId), { query: new URLSearchParams({ with_counts: 'true' }) }) as Promise<APIGuild>,
  ]);
  const user = member.user;
  const message = renderMessage(settings.message, {
    ...userVars(
      { id: user.id, username: user.username, globalName: user.global_name },
      { nickname: member.nick ?? null, joinedAt: member.joined_at ? new Date(member.joined_at) : null },
    ),
    ...guildVars({ id: guild.id, name: guild.name, memberCount: guild.approximate_member_count ?? 0 }),
  });

  const targetId =
    kind === 'dm'
      ? ((await rest.post(Routes.userChannels(), { body: { recipient_id: userId } })) as APIDMChannel).id
      : channelId!;
  await rest.post(Routes.channelMessages(targetId), { body: toRestMessage(message) });
  return { sent: true };
}

export function welcomeApi(app: FastifyInstance, ctx: ApiModuleContext<WelcomeConfig>): void {
  app.post(
    '/test',
    {
      schema: {
        tags: ['welcome'],
        summary: 'Send a test welcome as the current user',
        body: TestBody,
        response: { 200: TestResult },
      },
    },
    async (request) => {
      const { guildId } = request.params as { guildId: string };
      await ctx.requireEnabled(guildId);
      const { kind } = request.body as z.infer<typeof TestBody>;
      try {
        return await sendTestMessage(ctx.rest, await ctx.getConfig(guildId), { guildId, userId: ctx.currentUserId(request), kind });
      } catch (err) {
        request.log.warn({ err, guildId, kind }, 'Welcome test message failed');
        // Discord's own refusals (no access to the channel, a bad embed) help to fix the message; anything else stays in the log.
        return { sent: false, reason: err instanceof DiscordAPIError && err.status < 500 ? err.message : 'Discord request failed' };
      }
    },
  );
}
