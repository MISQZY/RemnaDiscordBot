import { HttpError, type ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PanelState, type VerificationConfig } from './config.js';
import { publishPanel } from './service.js';

export function verificationApi(app: FastifyInstance, ctx: ApiModuleContext<VerificationConfig>): void {
  const guildId = (request: FastifyRequest) => (request.params as { guildId: string }).guildId;

  app.get(
    '/panel',
    { schema: { tags: ['verification'], summary: 'Where the verification message is posted; null — not yet', response: { 200: PanelState } } },
    async (request) => {
      const row = await ctx.db.verificationPanel.findUnique({ where: { guildId: guildId(request) } });
      return row && { channelId: row.channelId, messageId: row.messageId, updatedAt: row.updatedAt.toISOString() };
    },
  );

  app.post(
    '/panel/publish',
    {
      schema: {
        tags: ['verification'],
        summary: 'Post the verification message from the saved config, or update the posted one',
        response: { 200: PanelState },
      },
    },
    async (request) => {
      const config = await ctx.getConfig(guildId(request));
      if (!config.panel.channelId) throw HttpError.badRequest('Choose the verification channel first', [{ path: ['panel', 'channelId'], message: 'Required' }]);
      await publishPanel(ctx, guildId(request), config);
      const row = (await ctx.db.verificationPanel.findUnique({ where: { guildId: guildId(request) } }))!;
      return { channelId: row.channelId, messageId: row.messageId, updatedAt: row.updatedAt.toISOString() };
    },
  );
}
