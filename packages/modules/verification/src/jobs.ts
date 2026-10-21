import { Snowflake } from '@bot/contracts';
import type { JobContext } from '@bot/core';
import { DiscordAPIError, RESTJSONErrorCodes, Routes, type APIGuildMember } from 'discord.js';
import { z } from 'zod';
import type { VerificationConfig } from './config.js';
import { isVerified } from './service.js';

const KickPayload = z.object({ userId: Snowflake });

/** Time to pass ran out: the member is kicked unless they passed (or were let in by hand) meanwhile. */
export async function kickUnverified(payload: unknown, ctx: JobContext<VerificationConfig>): Promise<void> {
  const { userId } = KickPayload.parse(payload);
  if (!(await ctx.config.isEnabled(ctx.guildId, 'verification'))) return;
  const config = await ctx.getConfig(ctx.guildId);
  let member: APIGuildMember;
  try {
    member = (await ctx.rest.get(Routes.guildMember(ctx.guildId, userId))) as APIGuildMember;
  } catch (err) {
    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember) return;
    throw err;
  }
  if (isVerified(new Set(member.roles), config)) return;
  await ctx.rest.delete(Routes.guildMember(ctx.guildId, userId), { reason: 'Verification: not passed in time' });
}
