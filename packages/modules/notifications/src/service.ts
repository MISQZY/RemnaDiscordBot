import { EntityChecker, HttpError, type CoreServices, type GuildEntities } from '@bot/core';
import { isUniqueViolation, type Prisma } from '@bot/db';
import { MAX_SUBSCRIPTIONS, toDto, type SubscriptionCreate, type SubscriptionDto, type SubscriptionUpdate } from './config.js';
import type { ApiProvider } from './api-source.js';
import { mergeSettings, sealSettings, storedSettings, type ApiSettingsInput } from './api-settings.js';
import { secrets } from './secrets.js';
import type { Provider, ProviderId, SourceInfo } from './providers.js';
import { newOwnSourceId, newWebhookToken } from './webhook.js';

/** A webhook's name is its source's: up to this long. */
const WEBHOOK_NAME_LENGTH = 100;

/** Why a change was refused — the bot turns it into a localized reply, the API into an HTTP error. */
export type SubscriptionProblem = 'limit' | 'conflict' | 'references' | 'notConfigured' | 'notFound' | 'sourceNotFound' | 'feedNotFound' | 'vipRequired';

export class SubscriptionError extends HttpError {
  constructor(
    readonly problem: SubscriptionProblem,
    error: HttpError,
  ) {
    super(error.statusCode, error.code, error.message, error.details);
  }
}

/** A guild's subscriptions to YouTube channels, Twitch streamers, feeds and its webhooks. Shared by the API and the bot. */
export class SubscriptionService {
  constructor(
    private readonly services: Pick<CoreServices, 'db' | 'i18n' | 'guildLocales' | 'config'>,
    private readonly providers: () => Map<ProviderId, Provider>,
  ) {}

  provider(id: ProviderId): Provider {
    const found = this.providers().get(id);
    if (!found) throw new SubscriptionError('notConfigured', HttpError.badRequest(`${id} is not configured on this platform`));
    return found;
  }

  async lookup(id: ProviderId, query: string): Promise<SourceInfo> {
    try {
      return await this.provider(id).lookup(query);
    } catch (err) {
      // Providers answer "not found" with a 400; everything else is an outage.
      if (err instanceof HttpError && !(err instanceof SubscriptionError)) throw new SubscriptionError(id === 'feed' ? 'feedNotFound' : 'sourceNotFound', err);
      throw err;
    }
  }

  async list(guildId: string): Promise<SubscriptionDto[]> {
    const rows = await this.services.db.notificationSubscription.findMany({ where: { guildId }, include: { source: true }, orderBy: { createdAt: 'asc' } });
    return rows.map(toDto);
  }

  async find(guildId: string, id: string) {
    const row = await this.services.db.notificationSubscription.findUnique({ where: { id }, include: { source: true } });
    if (!row || row.guildId !== guildId) throw new SubscriptionError('notFound', HttpError.notFound('Subscription not found'));
    return row;
  }

  async create(guildId: string, input: SubscriptionCreate, entities: GuildEntities): Promise<SubscriptionDto> {
    const { db, i18n, guildLocales } = this.services;
    if ((await db.notificationSubscription.count({ where: { guildId } })) >= MAX_SUBSCRIPTIONS) {
      throw new SubscriptionError('limit', HttpError.badRequest(`A guild can have at most ${MAX_SUBSCRIPTIONS} subscriptions`));
    }
    this.validate(entities, input.channelId, input.mentionRoleId);

    // A webhook and an API source are the subscription's own, named by the user; the others share one found on their platform.
    const name = input.query.slice(0, WEBHOOK_NAME_LENGTH);
    const source =
      input.provider === 'webhook'
        ? await db.notificationSource.create({ data: { provider: 'webhook', externalId: newOwnSourceId(), name } })
        : input.provider === 'api'
          ? await db.notificationSource.create({
              data: { provider: 'api', externalId: newOwnSourceId(), name, settings: sealSettings(await this.checkApi(guildId, input.api, null)) },
            })
          : await this.sharedSource(input.provider, input.query);
    try {
      const row = await db.notificationSubscription.create({
        data: {
          guildId,
          sourceId: source.id,
          channelId: input.channelId,
          mentionRoleId: input.mentionRoleId,
          // The default template is in the server's language.
          message: (input.message ?? {
            content: i18n.raw(await guildLocales.get(guildId), `notifications.defaults.${input.provider}`),
          }) as Prisma.InputJsonValue,
          ...(input.filter ? { filter: input.filter } : {}),
          ...(input.provider === 'webhook' ? { webhookToken: secrets().seal(newWebhookToken()) } : {}),
        },
        include: { source: true },
      });
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new SubscriptionError('conflict', new HttpError(409, 'CONFLICT', 'This guild is already subscribed to this source'));
      }
      throw err;
    }
  }

  /** A webhook's new secret address; the old one stops working. */
  async regenerateToken(guildId: string, id: string): Promise<SubscriptionDto> {
    const existing = await this.find(guildId, id);
    if (!existing.webhookToken) throw HttpError.badRequest('Only webhooks have an address');
    const row = await this.services.db.notificationSubscription.update({
      where: { id: existing.id },
      data: { webhookToken: secrets().seal(newWebhookToken()) },
      include: { source: true },
    });
    return toDto(row);
  }

  async update(guildId: string, id: string, input: SubscriptionUpdate, entities: GuildEntities): Promise<SubscriptionDto> {
    const existing = await this.find(guildId, id);
    this.validate(entities, input.channelId, input.mentionRoleId);
    const { db } = this.services;
    const { api, ...fields } = input;
    let sourceId: string | undefined;
    if (api) {
      if (existing.source.provider !== 'api') throw HttpError.badRequest('Only API sources have API settings');
      const before = storedSettings(existing.source.settings);
      const settings = await this.checkApi(guildId, api, before);
      const moved = before?.url !== settings.url || before.itemsPath !== settings.itemsPath || before.idField !== settings.idField;
      if (moved) {
        // Another address or list: what was seen there means nothing now. A new source starts unchecked, so its first
        // check only remembers; the old one, the subscription's alone, goes away below.
        sourceId = (await db.notificationSource.create({ data: { provider: 'api', externalId: newOwnSourceId(), name: existing.source.name, settings: sealSettings(settings) } })).id;
      } else {
        await db.notificationSource.update({ where: { id: existing.sourceId }, data: { settings: sealSettings(settings), lastError: null, failures: 0, nextCheckAt: null } });
      }
    }
    const row = await db.notificationSubscription.update({
      where: { id: existing.id },
      data: {
        ...fields,
        ...(sourceId ? { sourceId } : {}),
        ...(fields.message ? { message: fields.message as Prisma.InputJsonValue } : {}),
        // The last delivery's failure was about the old channel.
        ...(input.channelId && input.channelId !== existing.channelId ? { deliveryError: null } : {}),
      },
      include: { source: true },
    });
    if (sourceId) await db.notificationSource.delete({ where: { id: existing.sourceId } });
    return toDto(row);
  }

  async remove(guildId: string, id: string): Promise<void> {
    const { db } = this.services;
    const row = await this.find(guildId, id);
    await db.notificationSubscription.delete({ where: { id: row.id } });
    // A source without subscriptions is no longer needed — it stops being polled.
    await db.notificationSource.deleteMany({ where: { id: row.sourceId, subscriptions: { none: {} } } });
  }

  /** An API source's settings, checked by requesting the API; only in guilds the VIP feature allows. */
  private async checkApi(guildId: string, input: ApiSettingsInput | undefined, stored: ReturnType<typeof storedSettings>) {
    if (!input) throw HttpError.badRequest('An API source needs its settings', [{ path: ['api'], message: 'Required' }]);
    const provider = this.provider('api');
    if (provider.vipFeature && this.services.config.vip.featureLocked(guildId, provider.vipFeature)) {
      throw new SubscriptionError('vipRequired', new HttpError(403, 'VIP_REQUIRED', `"${provider.vipFeature}" needs VIP in this guild`));
    }
    const settings = mergeSettings(input, stored);
    await (provider as ApiProvider).check(settings);
    return settings;
  }

  private async sharedSource(provider: ProviderId, query: string) {
    const info = await this.lookup(provider, query);
    return this.services.db.notificationSource.upsert({
      where: { provider_externalId: { provider, externalId: info.externalId } },
      create: { provider, externalId: info.externalId, name: info.name },
      update: { name: info.name },
    });
  }

  private validate(entities: GuildEntities, channelId: string | undefined, mentionRoleId: string | null | undefined): void {
    const { issues } = new EntityChecker(entities).textChannel(channelId, ['channelId']).role(mentionRoleId, ['mentionRoleId']);
    if (issues.length > 0) throw new SubscriptionError('references', HttpError.badRequest('Subscription references unknown channels or roles', issues));
  }
}
