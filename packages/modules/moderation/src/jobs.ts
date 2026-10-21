import { Snowflake } from '@bot/contracts';
import type { JobContext } from '@bot/core';
import { DiscordAPIError, RESTJSONErrorCodes, Routes } from 'discord.js';
import { z } from 'zod';
import type { ModerationConfig } from './config.js';
import { LockdownService } from './lockdown.js';

const UnlockPayload = z.object({ channelIds: z.array(Snowflake) });

/** A lockdown with a duration ran out. */
export async function unlockJob(payload: unknown, ctx: JobContext<ModerationConfig>): Promise<void> {
  const { channelIds } = UnlockPayload.parse(payload);
  const unlocked = await new LockdownService(ctx).unlock(ctx.guildId, channelIds, { reason: 'Lockdown expired' });
  const config = await ctx.getConfig(ctx.guildId);
  if (!config.lockdown.announce) return;
  const content = ctx.i18n.t(await ctx.guildLocales.get(ctx.guildId), 'moderation.lockdown.lifted');
  for (const channelId of unlocked) {
    await ctx.rest.post(Routes.channelMessages(channelId), { body: { content, allowed_mentions: { parse: [] } } }).catch(() => undefined);
  }
}

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
