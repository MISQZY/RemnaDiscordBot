import { randomBytes } from 'node:crypto';
import { InviteLink, Snowflake } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SessionStore } from '../auth/sessions.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';
import { BOT_INVITE_PERMISSIONS } from '../permissions.js';
import { clearSessionCookie, setSessionCookie } from '../plugins/session.js';

const STATE_TTL_SEC = 10 * 60;

/** Только относительные пути веба — без открытого редиректа на чужой домен. */
export function safeRedirectPath(path: string | undefined, fallback: string): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
  return path;
}

export interface AuthRouteDeps extends ApiDeps {
  sessions: SessionStore;
}

export function authRoutes({ db, redis, oauth, sessions, options }: AuthRouteDeps): FastifyPluginAsyncZod {
  const redirectUri = `${options.publicUrl}/v1/auth/callback`;

  return async (app) => {
    app.get(
      '/v1/auth/login',
      {
        schema: {
          tags: ['auth'],
          summary: 'Начать вход через Discord',
          querystring: z.object({ redirect: z.string().optional() }),
        },
      },
      async (request, reply) => {
        const state = randomBytes(24).toString('base64url');
        const redirect = safeRedirectPath(request.query.redirect, options.defaultRedirect);
        await redis.set(RedisKeys.oauthState(state), redirect, 'EX', STATE_TTL_SEC);
        return reply.redirect(oauth.authorizeUrl(state, redirectUri));
      },
    );

    app.get(
      '/v1/auth/callback',
      {
        schema: {
          tags: ['auth'],
          summary: 'Возврат из Discord OAuth2',
          querystring: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }),
        },
      },
      async (request, reply) => {
        const { code, state, error } = request.query;
        if (error) throw ApiError.unauthorized(`Discord authorization was declined: ${error}`);
        if (!code || !state) throw ApiError.badRequest('Missing OAuth code or state');

        // State одноразовый: удаляем сразу, чтобы его нельзя было использовать повторно.
        const key = RedisKeys.oauthState(state);
        const redirect = await redis.get(key);
        await redis.del(key);
        if (redirect === null) throw ApiError.badRequest('Invalid or expired OAuth state');

        const tokens = await oauth.exchangeCode(code, redirectUri);
        const user = await oauth.getUser(tokens.accessToken);

        await db.dashboardUser.upsert({
          where: { id: user.id },
          create: { id: user.id, username: user.username, avatar: user.avatar },
          update: { username: user.username, avatar: user.avatar, lastSeenAt: new Date() },
        });

        const session = await sessions.create({
          userId: user.id,
          username: user.username,
          globalName: user.global_name,
          avatar: user.avatar,
          ...tokens,
        });
        setSessionCookie(reply, session, { secure: options.secureCookies, maxAgeSec: sessions.ttlSec });
        request.log.info({ userId: user.id }, 'User signed in');
        return reply.redirect(`${options.webOrigin}${redirect}`);
      },
    );

    app.post(
      '/v1/auth/logout',
      { schema: { tags: ['auth'], summary: 'Выйти', response: { 204: z.null() } } },
      async (request, reply) => {
        const session = request.session;
        if (session) {
          await sessions.destroy(session.id);
          await oauth.revoke(session.accessToken).catch((err: unknown) => request.log.warn({ err }, 'Token revoke failed'));
        }
        clearSessionCookie(reply);
        return reply.status(204).send(null);
      },
    );

    app.get(
      '/v1/auth/invite',
      {
        schema: {
          tags: ['auth'],
          summary: 'Ссылка для приглашения бота',
          querystring: z.object({ guildId: Snowflake.optional() }),
          response: { 200: InviteLink },
        },
      },
      async (request) => {
        const params = new URLSearchParams({
          client_id: options.clientId,
          scope: 'bot applications.commands',
          permissions: BOT_INVITE_PERMISSIONS.toString(),
        });
        if (request.query.guildId) {
          params.set('guild_id', request.query.guildId);
          params.set('disable_guild_select', 'true');
        }
        return { url: `https://discord.com/oauth2/authorize?${params}` };
      },
    );
  };
}
