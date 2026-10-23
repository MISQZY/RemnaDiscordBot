import type { ApiModuleContext, ModuleServices, SavedChange } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MusicConfig } from './config.js';
import { ControlAction, MusicKeys, PlayerState, type ControlMessage } from './state.js';

const guildId = (request: FastifyRequest) => (request.params as { guildId: string }).guildId;

const PlayerResponse = z.object({ active: z.boolean(), state: PlayerState.nullable() });

/** The dashboard's player: state written by the bot, actions sent to the cluster that has the player. */
export function musicApi(app: FastifyInstance, ctx: ApiModuleContext<MusicConfig>): void {
  async function readState(id: string): Promise<PlayerState | null> {
    const raw = await ctx.redis.get(MusicKeys.state(id));
    if (!raw) return null;
    const parsed = PlayerState.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  app.get(
    '/player',
    {
      schema: {
        tags: ['music'],
        summary: "The guild's player",
        description: 'While playing, the position moves on from `positionMs` at `updatedAt`.',
        response: { 200: PlayerResponse },
      },
    },
    async (request) => {
      const state = await readState(guildId(request));
      return { active: state !== null, state };
    },
  );

  app.post(
    '/player',
    {
      schema: {
        tags: ['music'],
        summary: 'Control the player',
        description: 'Executed asynchronously by the bot; `remove` takes a 1-based queue position, `seek` milliseconds.',
        body: ControlAction,
        response: { 202: z.object({ accepted: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const id = guildId(request);
      await ctx.requireEnabled(id);
      const accepted = (await readState(id)) !== null;
      if (accepted) {
        const message: ControlMessage = { guildId: id, userId: ctx.currentUserId(request), ...(request.body as ControlAction) };
        await ctx.redis.publish(MusicKeys.control, JSON.stringify(message));
      }
      return reply.code(202).send({ accepted });
    },
  );
}

/** The module was switched off: the guild's player stops and leaves the voice channel. */
export async function stopWhenDisabled(ctx: ModuleServices<MusicConfig>, { guildId, userId, before, after }: SavedChange<MusicConfig>): Promise<void> {
  if (!before.enabled || after.enabled || !(await ctx.redis.exists(MusicKeys.state(guildId)))) return;
  const message: ControlMessage = { guildId, userId, action: 'stop' };
  await ctx.redis.publish(MusicKeys.control, JSON.stringify(message));
}
