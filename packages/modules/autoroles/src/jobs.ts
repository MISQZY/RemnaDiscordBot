import { Snowflake } from '@bot/contracts';
import type { JobContext } from '@bot/core';
import { DiscordAPIError, RESTJSONErrorCodes, Routes } from 'discord.js';
import { z } from 'zod';
import type { AutorolesConfig } from './config.js';

const AssignJoinRoles = z.object({ userId: Snowflake, roleIds: z.array(Snowflake) });

/** Отложенная выдача ролей при входе — через REST, без gateway. */
export async function assignJoinRoles(payload: unknown, ctx: JobContext<AutorolesConfig>): Promise<void> {
  const { userId, roleIds } = AssignJoinRoles.parse(payload);
  for (const roleId of roleIds) {
    try {
      await ctx.rest.put(Routes.guildMemberRole(ctx.guildId, userId, roleId), { reason: 'Autoroles: join roles' });
    } catch (err) {
      // Участник уже вышел или роль удалили — повторять бессмысленно.
      if (err instanceof DiscordAPIError && [RESTJSONErrorCodes.UnknownMember, RESTJSONErrorCodes.UnknownRole].includes(err.code as number)) {
        ctx.logger.debug({ userId, roleId, code: err.code }, 'Join role skipped');
        continue;
      }
      throw err;
    }
  }
}
