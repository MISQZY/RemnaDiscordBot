import { BotProfile, BotProfilePatch, Snowflake } from '@bot/contracts';
import { DiscordAPIError, Routes, type APIGuildMember, type APIUser } from 'discord.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { recordAudit } from '../audit.js';
import type { UserGuildService } from '../auth/user-guilds.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';
import { requireGuildAccess } from '../plugins/guild-access.js';
import { GUILD_WRITE_LIMIT } from '../plugins/rate-limit.js';
import { requireSession } from '../plugins/session.js';

const GuildParams = z.object({ guildId: Snowflake });
const CDN = 'https://cdn.discordapp.com';

/** Discord limits how often a profile picture changes: a server gets two picture changes in ten minutes. */
const PICTURE_CHANGES = 2;
const PICTURE_WINDOW_SEC = 600;
/** The pictures come as data URIs: the default 1 MB body would refuse them. */
const BODY_LIMIT = 24 * 1024 * 1024;

const picture = (hash: string, size: number) => `${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;

/**
 * The bot's profile on one server (Modify Current Member): a name, avatar, banner and "About me" seen only there.
 * Discord gives back the name and the pictures; the "About me" is kept as last set.
 */
export function profileRoutes({ db, rest, redis, snapshots, config, options }: ApiDeps, userGuilds: UserGuildService): FastifyPluginAsyncZod {
  let self: Promise<APIUser> | undefined;
  const botUser = () => (self ??= rest.get(Routes.user()) as Promise<APIUser>);

  async function read(guildId: string): Promise<BotProfile> {
    const user = await botUser();
    const member = (await rest.get(Routes.guildMember(guildId, user.id))) as APIGuildMember & { banner?: string | null };
    const guild = await db.guild.findUnique({ where: { id: guildId }, select: { botBio: true } });
    const base = `${CDN}/guilds/${guildId}/users/${user.id}`;
    return {
      nick: member.nick ?? null,
      avatarUrl: member.avatar ? `${base}/avatars/${picture(member.avatar, 256)}` : null,
      bannerUrl: member.banner ? `${base}/banners/${picture(member.banner, 600)}` : null,
      bio: guild?.botBio ?? null,
      global: { name: user.global_name ?? user.username, avatarUrl: user.avatar ? `${CDN}/avatars/${user.id}/${picture(user.avatar, 256)}` : null },
      editable: options.botProfileEdits,
      vipRequired: config.vip.featureLocked(guildId, 'profile'),
    };
  }

  return async (app) => {
    app.addHook('preHandler', requireGuildAccess(userGuilds));

    app.get(
      '/v1/guilds/:guildId/profile',
      { schema: { tags: ['guilds'], summary: "The bot's name, avatar, banner and About me on this server", params: GuildParams, response: { 200: BotProfile } } },
      async (request) => {
        if (!(await snapshots.isPresent(request.params.guildId))) throw ApiError.botNotInGuild();
        return read(request.params.guildId);
      },
    );

    app.patch(
      '/v1/guilds/:guildId/profile',
      {
        schema: {
          tags: ['guilds'],
          summary: "Change the bot's profile on this server; null resets a part to the global profile",
          description: 'Pictures are data URIs (PNG, JPEG, GIF, WebP, up to 8 MB); at most two picture changes per server in ten minutes.',
          params: GuildParams,
          body: BotProfilePatch,
          response: { 200: BotProfile },
        },
        bodyLimit: BODY_LIMIT,
        config: { rateLimit: GUILD_WRITE_LIMIT },
      },
      async (request) => {
        const { guildId } = request.params;
        if (!options.botProfileEdits) throw ApiError.forbidden("The bot's owner does not let servers change its profile");
        if (!(await snapshots.isPresent(guildId))) throw ApiError.botNotInGuild();
        if (config.vip.featureLocked(guildId, 'profile')) throw ApiError.featureNeedsVip('profile');
        const patch = request.body;

        if (patch.avatar !== undefined || patch.banner !== undefined) {
          const key = `profile:pictures:${guildId}`;
          const changes = await redis.incr(key);
          if (changes === 1) await redis.expire(key, PICTURE_WINDOW_SEC);
          if (changes > PICTURE_CHANGES) throw ApiError.tooManyRequests('The pictures were changed recently; try again in a few minutes');
        }

        const before = await read(guildId);
        const { bio, ...discord } = patch;
        if (Object.keys(discord).length > 0 || bio !== undefined) {
          try {
            // '@me' by default: passed by hand, the route helper would percent-encode it.
            await rest.patch(Routes.guildMember(guildId), {
              body: { ...discord, ...(bio !== undefined ? { bio } : {}) },
              reason: `Dashboard: ${requireSession(request).userId}`,
            });
          } catch (err) {
            // Discord's refusal (a picture it does not take, no Change Nickname) — with its message.
            if (err instanceof DiscordAPIError && err.status < 500) throw ApiError.badRequest(err.message);
            throw err;
          }
        }
        if (bio !== undefined) await db.guild.upsert({ where: { id: guildId }, create: { id: guildId, botBio: bio }, update: { botBio: bio } });

        const after = await read(guildId);
        // Pictures go to the history as "changed", not their data.
        const summary = (p: BotProfile) => ({ nick: p.nick, avatar: p.avatarUrl, banner: p.bannerUrl, bio: p.bio });
        await recordAudit(db, { guildId, userId: requireSession(request).userId, action: 'guild.profile', diff: { before: summary(before), after: summary(after) } });
        return after;
      },
    );
  };
}
