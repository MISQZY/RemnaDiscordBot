import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import type { Prisma } from '@bot/db';
import { DiscordAPIError, RESTJSONErrorCodes, Routes } from 'discord.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Panel, PanelInput, type AutorolesConfig } from './config.js';
import { panelMessageBody, toPanel } from './panel.js';

const PanelParams = z.object({ guildId: z.string(), panelId: z.string() });

export function autorolesApi(app: FastifyInstance, ctx: ApiModuleContext<AutorolesConfig>): void {
  const params = (request: FastifyRequest) => request.params as { guildId: string; panelId?: string };

  async function findPanel(guildId: string, panelId: string) {
    const row = await ctx.db.rolePanel.findUnique({ where: { id: panelId } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Role panel not found');
    return row;
  }

  async function validate(guildId: string, input: PanelInput): Promise<void> {
    const checker = new EntityChecker(await ctx.guildEntities(guildId)).textChannel(input.channelId, ['channelId']);
    input.items.forEach((item, i) => checker.assignableRole(item.roleId, ['items', i, 'roleId']));
    if (checker.issues.length > 0) throw HttpError.badRequest('Panel references unknown or unusable channels or roles', checker.issues);
  }

  const data = (input: PanelInput) => ({
    channelId: input.channelId,
    kind: input.kind,
    mode: input.mode,
    maxRoles: input.maxRoles,
    message: input.message as Prisma.InputJsonValue,
    items: input.items as Prisma.InputJsonValue,
  });

  app.get('/panels', { schema: { tags: ['autoroles'], summary: 'Панели ролей', response: { 200: z.array(Panel) } } }, async (request) => {
    const rows = await ctx.db.rolePanel.findMany({ where: { guildId: params(request).guildId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toPanel);
  });

  app.post(
    '/panels',
    { schema: { tags: ['autoroles'], summary: 'Создать панель ролей', body: PanelInput, response: { 201: Panel } } },
    async (request, reply) => {
      const { guildId } = params(request);
      const input = request.body as PanelInput;
      await validate(guildId, input);
      const row = await ctx.db.rolePanel.create({ data: { guildId, ...data(input) } });
      return reply.status(201).send(toPanel(row));
    },
  );

  app.get(
    '/panels/:panelId',
    { schema: { tags: ['autoroles'], summary: 'Панель ролей', params: PanelParams, response: { 200: Panel } } },
    async (request) => toPanel(await findPanel(params(request).guildId, params(request).panelId!)),
  );

  app.put(
    '/panels/:panelId',
    {
      schema: {
        tags: ['autoroles'],
        summary: 'Изменить панель ролей',
        description: 'Сообщение в Discord обновляется отдельным вызовом publish; при смене канала старое удаляется.',
        params: PanelParams,
        body: PanelInput,
        response: { 200: Panel },
      },
    },
    async (request) => {
      const { guildId, panelId } = params(request);
      const row = await findPanel(guildId, panelId!);
      const input = request.body as PanelInput;
      await validate(guildId, input);

      // Сменился канал — старое сообщение удаляем, при publish панель отправится в новый.
      const moved = row.messageId !== null && row.channelId !== input.channelId;
      if (moved) await ctx.rest.delete(Routes.channelMessage(row.channelId, row.messageId!)).catch(() => undefined);
      return toPanel(
        await ctx.db.rolePanel.update({ where: { id: row.id }, data: { ...data(input), ...(moved ? { messageId: null } : {}) } }),
      );
    },
  );

  app.delete(
    '/panels/:panelId',
    { schema: { tags: ['autoroles'], summary: 'Удалить панель и её сообщение', params: PanelParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const { guildId, panelId } = params(request);
      const row = await findPanel(guildId, panelId!);
      if (row.messageId) {
        await ctx.rest.delete(Routes.channelMessage(row.channelId, row.messageId)).catch(() => undefined);
      }
      await ctx.db.rolePanel.delete({ where: { id: row.id } });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/panels/:panelId/publish',
    {
      schema: {
        tags: ['autoroles'],
        summary: 'Опубликовать или обновить сообщение панели в Discord',
        params: PanelParams,
        response: { 200: Panel },
      },
    },
    async (request) => {
      const { guildId, panelId } = params(request);
      const row = await findPanel(guildId, panelId!);
      const panel = toPanel(row);
      const body = panelMessageBody(panel);

      let messageId = row.messageId;
      if (messageId) {
        try {
          await ctx.rest.patch(Routes.channelMessage(row.channelId, messageId), { body });
        } catch (err) {
          // Сообщение удалили вручную — публикуем заново.
          if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage)) throw err;
          messageId = null;
        }
      }
      messageId ??= ((await ctx.rest.post(Routes.channelMessages(row.channelId), { body })) as { id: string }).id;
      return toPanel(await ctx.db.rolePanel.update({ where: { id: row.id }, data: { messageId } }));
    },
  );
}
