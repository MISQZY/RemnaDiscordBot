import { HttpError, RedisKeys, type ApiModuleContext, type ModuleServices, type SavedChange } from '@bot/core';
import { Routes } from 'discord.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MusicConfig } from './config.js';
import { SourcesState } from './sources.js';
import { ControlAction, MusicKeys, PlayerState, type ControlMessage } from './state.js';

const guildId = (request: FastifyRequest) => (request.params as { guildId: string }).guildId;

const PlayerResponse = z.object({
  active: z.boolean(),
  state: PlayerState.nullable(),
  canControl: z.boolean().default(false),
  guild: z.object({ id: z.string(), name: z.string(), icon: z.string().nullable() }).nullable().optional(),
});

/** The dashboard's player: state written by the bot, actions sent to the cluster that has the player. */
export function musicApi(app: FastifyInstance, ctx: ApiModuleContext<MusicConfig>): void {
  async function readState(id: string): Promise<PlayerState | null> {
    const raw = await ctx.redis.get(MusicKeys.state(id));
    if (!raw) return null;
    const parsed = PlayerState.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  async function userHasDjRole(id: string, userId: string, djRoleIds: string[]): Promise<boolean> {
    if (djRoleIds.length === 0) return false;
    const cacheKey = RedisKeys.guildMemberRoles(id, userId);
    const cached = await ctx.redis.get(cacheKey);
    let memberRoleIds: string[] | null = cached ? JSON.parse(cached) : null;
    if (!memberRoleIds && ctx.rest) {
      try {
        const member = (await ctx.rest.get(Routes.guildMember(id, userId))) as { roles?: string[] };
        memberRoleIds = Array.isArray(member?.roles) ? member.roles : [];
        await ctx.redis.set(cacheKey, JSON.stringify(memberRoleIds), 'EX', 60);
      } catch {
        memberRoleIds = [];
      }
    }
    if (!memberRoleIds || memberRoleIds.length === 0) return false;
    const roleSet = new Set(memberRoleIds);
    return djRoleIds.some((roleId) => roleSet.has(roleId));
  }

  async function checkCanControl(request: FastifyRequest, id: string): Promise<boolean> {
    if (request.guild?.canManage) return true;
    const config = await ctx.getConfig(id);
    if (config.djRoleIds.length === 0) return true;
    const userId = ctx.currentUserId(request);
    return await userHasDjRole(id, userId, config.djRoleIds);
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
      const id = guildId(request);
      const state = await readState(id);
      const canControl = await checkCanControl(request, id);
      const metaRaw = await ctx.redis.get(RedisKeys.guildMeta(id));
      const meta = metaRaw ? (JSON.parse(metaRaw) as { id: string; name: string; icon?: string | null }) : null;
      return {
        active: state !== null,
        state,
        canControl,
        guild: meta ? { id: meta.id, name: meta.name, icon: meta.icon ?? null } : null,
      };
    },
  );

  app.get(
    '/sources',
    {
      schema: {
        tags: ['music'],
        summary: 'Search sources that work',
        description:
          'Checked by the bot every few minutes: the audio node has the source on and its search answers without an error. ' +
          'Empty with `checkedAt: null` while the bot has not reached Lavalink or music is off.',
        response: { 200: SourcesState },
      },
    },
    async (): Promise<SourcesState> => {
      const raw = await ctx.redis.get(MusicKeys.sources);
      const parsed = raw ? SourcesState.safeParse(JSON.parse(raw)) : null;
      return parsed?.success ? parsed.data : { sources: [], checkedAt: null };
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
      if (!(await checkCanControl(request, id))) {
        throw HttpError.forbidden('Only administrators and DJs can control the player');
      }
      const accepted = (await readState(id)) !== null;
      if (accepted) {
        const message: ControlMessage = { guildId: id, userId: ctx.currentUserId(request), ...(request.body as ControlAction) };
        await ctx.redis.publish(MusicKeys.control, JSON.stringify(message));
      }
      return reply.code(202).send({ accepted });
    },
  );
}

/** Public view of the player: accessible without credentials when music is enabled. */
export function musicPublicApi(app: FastifyInstance, ctx: ModuleServices<MusicConfig>): void {
  app.get(
    '/player',
    {
      schema: {
        tags: ['music'],
        summary: "The guild's public player state",
        response: {
          200: z.object({
            active: z.boolean(),
            state: PlayerState.nullable(),
            canControl: z.literal(false),
            guild: z.object({ id: z.string(), name: z.string(), icon: z.string().nullable() }).nullable().optional(),
          }),
        },
      },
    },
    async (request) => {
      const id = guildId(request);
      const raw = await ctx.redis.get(MusicKeys.state(id));
      const parsed = raw ? PlayerState.safeParse(JSON.parse(raw)) : null;
      const state = parsed?.success ? parsed.data : null;
      const metaRaw = await ctx.redis.get(RedisKeys.guildMeta(id));
      const meta = metaRaw ? (JSON.parse(metaRaw) as { id: string; name: string; icon?: string | null }) : null;
      return {
        active: state !== null,
        state,
        canControl: false as const,
        guild: meta ? { id: meta.id, name: meta.name, icon: meta.icon ?? null } : null,
      };
    },
  );
}

/** The module was switched off: the guild's player stops and leaves the voice channel. */
export async function stopWhenDisabled(ctx: ModuleServices<MusicConfig>, { guildId, userId, before, after }: SavedChange<MusicConfig>): Promise<void> {
  if (!before.enabled || after.enabled || !(await ctx.redis.exists(MusicKeys.state(guildId)))) return;
  const message: ControlMessage = { guildId, userId, action: 'stop' };
  await ctx.redis.publish(MusicKeys.control, JSON.stringify(message));
}
