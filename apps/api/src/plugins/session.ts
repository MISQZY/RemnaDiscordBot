import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Session, SessionStore } from '../auth/sessions.js';
import { ApiError } from '../errors.js';

export const SESSION_COOKIE = 'sid';

declare module 'fastify' {
  interface FastifyRequest {
    /** Session from the signed `sid` cookie; `null` — the user is not logged in. */
    session: Session | null;
  }
}

export interface SessionPluginOptions {
  store: SessionStore;
  secret: string;
}

/** Loads the session from the signed cookie or an external client's bearer token before route handlers. */
export const sessionPlugin = fp<SessionPluginOptions>(async (app: FastifyInstance, { store, secret }) => {
  await app.register(cookie, { secret });
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request) => {
    // A client session works only as a bearer token and a cookie session only as a cookie: neither can be replayed as the other.
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (bearer) {
      const session = await store.get(bearer);
      request.session = session?.client ? session : null;
      return;
    }

    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const session = await store.get(unsigned.value);
    request.session = session && !session.client ? session : null;
  });
});

export function setSessionCookie(reply: FastifyReply, session: Session, options: { secure: boolean; maxAgeSec: number }) {
  reply.setCookie(SESSION_COOKIE, session.id, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure,
    path: '/',
    maxAge: options.maxAgeSec,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireSession(request: FastifyRequest): Session {
  if (!request.session) throw ApiError.unauthorized();
  return request.session;
}
