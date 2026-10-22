import { Snowflake } from '@bot/contracts';
import { EntityChecker, HttpError, type ApiModuleContext } from '@bot/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { InfoPanel, InfoPanelInput, Panel, PanelInput, type AutorolesConfig } from './config.js';
import { toInfoPanel } from './info-panel.js';
import { InfoPanelService } from './info-panel-service.js';
import { toPanel } from './panel.js';
import { PanelService } from './panel-service.js';

const PanelParams = z.object({ guildId: Snowflake, panelId: z.string() });

export function autorolesApi(app: FastifyInstance, ctx: ApiModuleContext<AutorolesConfig>): void {
  const panels = new PanelService(ctx.db, ctx.rest);
  const infoPanels = new InfoPanelService(ctx.db, ctx.rest);
  const params = (request: FastifyRequest) => request.params as { guildId: string; panelId: string };

  async function validate(guildId: string, input: PanelInput): Promise<void> {
    const checker = new EntityChecker(await ctx.guildEntities(guildId)).textChannel(input.channelId, ['channelId']);
    input.items.forEach((item, i) => checker.assignableRole(item.roleId, ['items', i, 'roleId']));
    if (checker.issues.length > 0) throw HttpError.badRequest('Panel references unknown or unusable channels or roles', checker.issues);
  }

  async function validateInfo(guildId: string, input: InfoPanelInput): Promise<void> {
    const checker = new EntityChecker(await ctx.guildEntities(guildId)).textChannel(input.channelId, ['channelId']);
    if (checker.issues.length > 0) throw HttpError.badRequest('Info panel references an unknown or unusable channel', checker.issues);
  }

  app.get('/panels', { schema: { tags: ['autoroles'], summary: 'Role panels', response: { 200: z.array(Panel) } } }, async (request) =>
    panels.list(params(request).guildId),
  );

  app.post(
    '/panels',
    { schema: { tags: ['autoroles'], summary: 'Create a role panel', body: PanelInput, response: { 201: Panel } } },
    async (request, reply) => {
      const { guildId } = params(request);
      const input = request.body as PanelInput;
      await validate(guildId, input);
      return reply.status(201).send(await panels.create(guildId, input));
    },
  );

  app.get(
    '/panels/:panelId',
    { schema: { tags: ['autoroles'], summary: 'Role panel', params: PanelParams, response: { 200: Panel } } },
    async (request) => toPanel(await panels.find(params(request).guildId, params(request).panelId)),
  );

  app.put(
    '/panels/:panelId',
    {
      schema: {
        tags: ['autoroles'],
        summary: 'Update a role panel',
        description: 'The Discord message is updated by a separate publish call; changing the channel deletes the old one.',
        params: PanelParams,
        body: PanelInput,
        response: { 200: Panel },
      },
    },
    async (request) => {
      const { guildId, panelId } = params(request);
      const input = request.body as PanelInput;
      await panels.find(guildId, panelId);
      await validate(guildId, input);
      return panels.update(guildId, panelId, input);
    },
  );

  app.delete(
    '/panels/:panelId',
    { schema: { tags: ['autoroles'], summary: 'Delete a panel and its message', params: PanelParams, response: { 204: z.null() } } },
    async (request, reply) => {
      await panels.delete(params(request).guildId, params(request).panelId);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/panels/:panelId/publish',
    { schema: { tags: ['autoroles'], summary: 'Post or update the panel message in Discord', params: PanelParams, response: { 200: Panel } } },
    async (request) => panels.publish(params(request).guildId, params(request).panelId),
  );

  app.get('/info-panels', { schema: { tags: ['autoroles'], summary: 'Info panels', response: { 200: z.array(InfoPanel) } } }, async (request) =>
    infoPanels.list(params(request).guildId),
  );

  app.post(
    '/info-panels',
    { schema: { tags: ['autoroles'], summary: 'Create an info panel', body: InfoPanelInput, response: { 201: InfoPanel } } },
    async (request, reply) => {
      const { guildId } = params(request);
      const input = request.body as InfoPanelInput;
      await validateInfo(guildId, input);
      return reply.status(201).send(await infoPanels.create(guildId, input));
    },
  );

  app.get(
    '/info-panels/:panelId',
    { schema: { tags: ['autoroles'], summary: 'Info panel', params: PanelParams, response: { 200: InfoPanel } } },
    async (request) => toInfoPanel(await infoPanels.find(params(request).guildId, params(request).panelId)),
  );

  app.put(
    '/info-panels/:panelId',
    {
      schema: {
        tags: ['autoroles'],
        summary: 'Update an info panel',
        description: 'The Discord message is updated by a separate publish call; changing the channel deletes the old one.',
        params: PanelParams,
        body: InfoPanelInput,
        response: { 200: InfoPanel },
      },
    },
    async (request) => {
      const { guildId, panelId } = params(request);
      const input = request.body as InfoPanelInput;
      await infoPanels.find(guildId, panelId);
      await validateInfo(guildId, input);
      return infoPanels.update(guildId, panelId, input);
    },
  );

  app.delete(
    '/info-panels/:panelId',
    { schema: { tags: ['autoroles'], summary: 'Delete an info panel and its message', params: PanelParams, response: { 204: z.null() } } },
    async (request, reply) => {
      await infoPanels.delete(params(request).guildId, params(request).panelId);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/info-panels/:panelId/publish',
    { schema: { tags: ['autoroles'], summary: 'Post or update the info panel message in Discord', params: PanelParams, response: { 200: InfoPanel } } },
    async (request) => infoPanels.publish(params(request).guildId, params(request).panelId),
  );
}
