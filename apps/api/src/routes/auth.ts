import { randomBytes } from 'node:crypto';
import { InviteLink, SessionToken, SessionTokenRequest, Snowflake } from '@bot/contracts';
import { RedisKeys } from '@bot/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticateClient, clientRedirect } from '../auth/link-clients.js';
import type { SessionStore } from '../auth/sessions.js';
import type { ApiDeps } from '../deps.js';
import { ApiError } from '../errors.js';
import { BOT_INVITE_PERMISSIONS } from '../permissions.js';
import { clearSessionCookie, setSessionCookie } from '../plugins/session.js';

const STATE_TTL_SEC = 10 * 60;
/** The code travels through the browser to the client's server, which exchanges it right away. */
const CODE_TTL_SEC = 60;

/** Where a login started: the API's own web (cookie) or an external client (code to its callback). */
type LoginFlow = { redirect: string } | { client: string; state: string };

/** Only relative web paths — no open redirect to another domain. */
export function safeRedirectPath(path: string | undefined, fallback: string): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
  return path;
}

export interface AuthRouteDeps extends ApiDeps {
  sessions: SessionStore;
}

/** Reads and deletes a single-use value, so that it cannot be used twice. */
async function take(redis: ApiDeps['redis'], key: string): Promise<string | null> {
  const value = await redis.get(key);
  if (value !== null) await redis.del(key);
  return value;
}

export function authRoutes({ db, redis, oauth, sessions, options }: AuthRouteDeps): FastifyPluginAsyncZod {
  const redirectUri = `${options.publicUrl}/v1/auth/callback`;

  return async (app) => {
    app.get(
      '/v1/auth/login',
      {
        schema: {
          tags: ['auth'],
          summary: 'Start Discord login',
          description:
            "With `client` the login is for an external dashboard: it ends on the client's callback with a single-use `code` and the client's `state`.",
          querystring: z.object({
            redirect: z.string().optional(),
            client: z.string().optional(),
            state: z.string().max(1024).optional(),
          }),
        },
      },
      async (request, reply) => {
        const { client: clientId, state: clientState, redirect } = request.query;
        let flow: LoginFlow;
        if (clientId) {
          if (!options.linkClients.some((c) => c.id === clientId)) throw ApiError.badRequest('Unknown client');
          if (!clientState) throw ApiError.badRequest('Missing client state');
          flow = { client: clientId, state: clientState };
        } else {
          flow = { redirect: safeRedirectPath(redirect, options.defaultRedirect) };
        }
        const state = randomBytes(24).toString('base64url');
        await redis.set(RedisKeys.oauthState(state), JSON.stringify(flow), 'EX', STATE_TTL_SEC);
        return reply.redirect(oauth.authorizeUrl(state, redirectUri));
      },
    );

    app.get(
      '/v1/auth/callback',
      {
        schema: {
          tags: ['auth'],
          summary: 'Discord OAuth2 callback',
          querystring: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }),
        },
      },
      async (request, reply) => {
        const { code, state, error } = request.query;
        if (!state) {
          if (error) throw ApiError.unauthorized(`Discord authorization was declined: ${error}`);
          throw ApiError.badRequest('Missing OAuth code or state');
        }

        // The state is single-use: delete it right away so it cannot be reused.
        const raw = await take(redis, RedisKeys.oauthState(state));
        if (raw === null) throw ApiError.badRequest('Invalid or expired OAuth state');
        const flow = JSON.parse(raw) as LoginFlow;
        const client = 'client' in flow ? options.linkClients.find((c) => c.id === flow.client) : undefined;
        if ('client' in flow && !client) throw ApiError.badRequest('Unknown client');

        if (error || !code) {
          // The client shows the failure on its own site.
          if (client && 'client' in flow) {
            return reply.redirect(clientRedirect(client, { error: error ?? 'invalid_request', state: flow.state }));
          }
          if (error) throw ApiError.unauthorized(`Discord authorization was declined: ${error}`);
          throw ApiError.badRequest('Missing OAuth code or state');
        }

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
          ...(client ? { client: client.id } : {}),
        });
        request.log.info({ userId: user.id, client: client?.id }, 'User signed in');

        if (client && 'client' in flow) {
          // The session token never passes through the browser: only a short-lived code the client's server exchanges.
          const loginCode = randomBytes(32).toString('base64url');
          const grant = JSON.stringify({ sessionId: session.id, client: client.id });
          await redis.set(RedisKeys.oauthCode(loginCode), grant, 'EX', CODE_TTL_SEC);
          return reply.redirect(clientRedirect(client, { code: loginCode, state: flow.state }));
        }

        setSessionCookie(reply, session, { secure: options.secureCookies, maxAgeSec: sessions.ttlSec });
        return reply.redirect(`${options.webOrigin}${'redirect' in flow ? flow.redirect : options.defaultRedirect}`);
      },
    );

    app.post(
      '/v1/auth/token',
      {
        schema: {
          tags: ['auth'],
          summary: 'Exchange an external client login code for a session token',
          description: 'Server to server: `Authorization: Basic base64(clientId:secret)`. The code is single-use and lives a minute.',
          security: [{ client: [] }],
          body: SessionTokenRequest,
          response: { 200: SessionToken },
        },
      },
      async (request) => {
        const client = authenticateClient(options.linkClients, request.headers.authorization);
        if (!client) throw ApiError.unauthorized('Unknown client or wrong secret');

        const raw = await take(redis, RedisKeys.oauthCode(request.body.code));
        const grant = raw ? (JSON.parse(raw) as { sessionId: string; client: string }) : null;
        const session = grant?.client === client.id ? await sessions.get(grant.sessionId) : null;
        if (!session) throw ApiError.badRequest('Invalid or expired code');

        return {
          token: session.id,
          user: { id: session.userId, username: session.username, globalName: session.globalName, avatar: session.avatar },
        };
      },
    );

    app.post(
      '/v1/auth/logout',
      { schema: { tags: ['auth'], summary: 'Log out', response: { 204: z.null() } } },
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
          summary: 'Bot invite link',
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
