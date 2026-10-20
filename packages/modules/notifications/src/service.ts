import { EntityChecker, HttpError, type CoreServices, type GuildEntities } from '@bot/core';
import { isUniqueViolation, type Prisma } from '@bot/db';
import { MAX_SUBSCRIPTIONS, toDto, type SubscriptionCreate, type SubscriptionDto, type SubscriptionUpdate } from './config.js';
import type { Provider, ProviderId, SourceInfo } from './providers.js';

/** Why a change was refused — the bot turns it into a localized reply, the API into an HTTP error. */
export type SubscriptionProblem = 'limit' | 'conflict' | 'references' | 'notConfigured' | 'notFound' | 'sourceNotFound';

export class SubscriptionError extends HttpError {
  constructor(
    readonly problem: SubscriptionProblem,
    error: HttpError,
  ) {
    super(error.statusCode, error.code, error.message, error.details);
  }
}

/** A guild's subscriptions to YouTube channels and Twitch streamers. Shared by the API and the bot. */
export class SubscriptionService {
  constructor(
    private readonly services: Pick<CoreServices, 'db' | 'i18n' | 'guildLocales'>,
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
      if (err instanceof HttpError && !(err instanceof SubscriptionError)) throw new SubscriptionError('sourceNotFound', err);
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

    const info = await this.lookup(input.provider, input.query);
    const source = await db.notificationSource.upsert({
      where: { provider_externalId: { provider: input.provider, externalId: info.externalId } },
      create: { provider: input.provider, externalId: info.externalId, name: info.name },
      update: { name: info.name },
    });
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

  async update(guildId: string, id: string, input: SubscriptionUpdate, entities: GuildEntities): Promise<SubscriptionDto> {
    const existing = await this.find(guildId, id);
    this.validate(entities, input.channelId, input.mentionRoleId);
    const row = await this.services.db.notificationSubscription.update({
      where: { id: existing.id },
      data: { ...input, ...(input.message ? { message: input.message as Prisma.InputJsonValue } : {}) },
      include: { source: true },
    });
    return toDto(row);
  }

  async remove(guildId: string, id: string): Promise<void> {
    const { db } = this.services;
    const row = await this.find(guildId, id);
    await db.notificationSubscription.delete({ where: { id: row.id } });
    // A source without subscriptions is no longer needed — it stops being polled.
    await db.notificationSource.deleteMany({ where: { id: row.sourceId, subscriptions: { none: {} } } });
  }

  private validate(entities: GuildEntities, channelId: string | undefined, mentionRoleId: string | null | undefined): void {
    const { issues } = new EntityChecker(entities).textChannel(channelId, ['channelId']).role(mentionRoleId, ['mentionRoleId']);
    if (issues.length > 0) throw new SubscriptionError('references', HttpError.badRequest('Subscription references unknown channels or roles', issues));
  }
}
