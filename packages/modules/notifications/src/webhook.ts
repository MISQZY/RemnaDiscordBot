import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Snowflake } from '@bot/contracts';
import { HttpError, type ModuleServices } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { NotificationsConfig } from './config.js';
import { deliver } from './poll.js';

// Incoming webhooks: a subscription with its own secret address. Anything that can send an HTTP request — GitHub,
// Grafana, n8n, a script — posts JSON (or plain text) there, and the bot announces it with the subscription's
// template, the fields of the body as {body.…} placeholders.

/** A secret part of a webhook's address: 192 random bits. */
export const newWebhookToken = () => randomBytes(24).toString('base64url');

/** A webhook source is the subscription's own: its ID only has to be unique. */
export const newWebhookSourceId = () => randomUUID();

export const WEBHOOK_LIMITS = {
  /** Requests a webhook accepts per minute: each is a message in Discord. */
  perMinute: 30,
  bodyBytes: 256 * 1024,
  /** How deep into the body placeholders go, how many there are, and how long a value may be. */
  depth: 6,
  vars: 300,
  value: 1000,
  /** How much of the body's text filters look at. */
  text: 4000,
} as const;

/** A placeholder's segment: a letter first, then letters, digits or `_` (see @bot/templates). */
const SEGMENT = /^\p{L}[\p{L}\p{N}_]*$/u;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The body as placeholders: `{body.a.b}` for nested fields, `{body.list.count}`, `{body.list.first.…}` and
 * `{body.list.last.…}` for arrays, `{body.list.items}` for an array of plain values joined. A text body is `{body.text}`.
 * Keys that cannot be a placeholder (`x-id` becomes `x_id`, `2fa` is left out) and deep or excess fields are dropped.
 */
export function payloadVars(body: unknown): { vars: Record<string, string | number>; text: string } {
  const vars: Record<string, string | number> = {};
  const texts: string[] = [];
  let count = 0;

  const set = (key: string, value: string | number) => {
    if (count >= WEBHOOK_LIMITS.vars) return;
    count++;
    vars[key] = typeof value === 'string' ? clip(value, WEBHOOK_LIMITS.value) : value;
    if (typeof value === 'string') texts.push(value);
  };
  const walk = (node: unknown, path: string, depth: number): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number') return set(path, node);
    if (typeof node === 'boolean') return set(path, String(node));
    if (typeof node !== 'object' || depth >= WEBHOOK_LIMITS.depth) return;
    if (Array.isArray(node)) {
      set(`${path}.count`, node.length);
      const plain = node.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
      if (plain.length > 0) set(`${path}.items`, plain.join(', '));
      if (node.length > 0) walk(node[0], `${path}.first`, depth + 1);
      if (node.length > 1) walk(node.at(-1), `${path}.last`, depth + 1);
      return;
    }
    for (const [raw, value] of Object.entries(node)) {
      const key = raw.replace(/[-\s]/g, '_');
      if (SEGMENT.test(key)) walk(value, `${path}.${key}`, depth + 1);
    }
  };

  if (typeof body === 'string') set('body.text', body);
  else walk(body, 'body', 0);
  return { vars, text: clip(texts.join('\n'), WEBHOOK_LIMITS.text) };
}

/** What happened, from the headers senders mark it with: GitHub's `push`, GitLab's `Push Hook`, or `?event=`. */
function eventOf(request: FastifyRequest): string {
  const header = (name: string) => {
    const value = request.headers[name];
    return typeof value === 'string' ? value : '';
  };
  const query = (request.query as { event?: unknown } | undefined)?.event;
  return header('x-github-event') || header('x-gitlab-event') || header('x-event') || (typeof query === 'string' ? query : '');
}

function sameToken(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const HookParams = z.object({ guildId: Snowflake, subscriptionId: z.string().min(1).max(64), token: z.string().min(1).max(100) });

/** `POST …/hooks/:subscriptionId/:token`, public: the token is the only key. Mounted under the module's public routes. */
export function notificationsPublicApi(app: FastifyInstance, ctx: ModuleServices<NotificationsConfig>): void {
  app.post(
    '/hooks/:subscriptionId/:token',
    {
      bodyLimit: WEBHOOK_LIMITS.bodyBytes,
      schema: {
        tags: ['notifications'],
        summary: 'Incoming webhook: announce the body with the subscription template',
        description: `JSON or plain text, up to ${WEBHOOK_LIMITS.bodyBytes / 1024} KB and ${WEBHOOK_LIMITS.perMinute} requests a minute. 204 — posted or filtered out.`,
        security: [],
        params: HookParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { guildId, subscriptionId, token } = request.params as z.infer<typeof HookParams>;
      const row = await ctx.db.notificationSubscription.findUnique({ where: { id: subscriptionId }, include: { source: true } });
      // A wrong token reads as no webhook at all.
      if (!row || row.guildId !== guildId || !row.webhookToken || !sameToken(row.webhookToken, token)) throw HttpError.notFound('Webhook not found');
      if (!row.enabled) throw new HttpError(409, 'CONFLICT', 'The subscription is disabled');

      // The window starts with the first request: SET NX gives the key its TTL once, INCR keeps it.
      const key = `notifications:hook:${row.id}`;
      const counted = await ctx.redis.multi().set(key, 0, 'PX', 60_000, 'NX').incr(key).pttl(key).exec();
      if (Number(counted?.[1]?.[1] ?? 0) > WEBHOOK_LIMITS.perMinute) {
        const retrySec = Math.max(1, Math.ceil(Number(counted?.[2]?.[1] ?? 60_000) / 1000));
        reply.header('retry-after', retrySec);
        throw new HttpError(429, 'RATE_LIMITED', `Too many requests, retry in ${retrySec}s`);
      }

      const { vars, text } = payloadVars(request.body);
      vars['hook.name'] = row.source.name;
      vars['hook.event'] = eventOf(request);
      const now = new Date();
      await ctx.db.notificationSource.update({ where: { id: row.sourceId }, data: { lastCheckedAt: now, lastSuccessAt: now } });

      const result = await deliver(ctx, row, { id: randomUUID(), vars, text });
      if (result !== 'posted' && result !== 'skipped') throw new HttpError(502, 'DISCORD_UNAVAILABLE', `Discord did not take the message: ${result}`);
      return reply.status(204).send(null);
    },
  );
}
