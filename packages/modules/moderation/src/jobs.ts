import { Snowflake } from '@bot/contracts';
import type { JobContext } from '@bot/core';
import { DiscordAPIError, RESTJSONErrorCodes, Routes } from 'discord.js';
import { z } from 'zod';
import type { ModerationConfig } from './config.js';

const UnbanPayload = z.object({ userId: Snowflake });

/** A temporary ban expired. No separate case is created: the term is stored in `expiresAt`. */
export async function unbanJob(payload: unknown, ctx: JobContext<ModerationConfig>): Promise<void> {
  const { userId } = UnbanPayload.parse(payload);
  try {
    await ctx.rest.delete(Routes.guildBan(ctx.guildId, userId), { reason: 'Temporary ban expired' });
  } catch (err) {
    // Already unbanned manually.
    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownBan) return;
    throw err;
  }
}
