import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Session, SessionStore } from '../auth/sessions.js';
import { ApiError } from '../errors.js';

export const SESSION_COOKIE = 'sid';

declare module 'fastify' {
  interface FastifyRequest {
    /** Сессия из подписанной cookie `sid`; `null` — пользователь не вошёл. */
    session: Session | null;
  }
}

export interface SessionPluginOptions {
  store: SessionStore;
  secret: string;
}

/** Достаёт сессию из подписанной cookie до обработчиков. */
export const sessionPlugin = fp<SessionPluginOptions>(async (app: FastifyInstance, { store, secret }) => {
  await app.register(cookie, { secret });
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    request.session = await store.get(unsigned.value);
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
