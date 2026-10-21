import { randomInt } from 'node:crypto';
import { HttpError, type CoreServices } from '@bot/core';
import type { Giveaway, Prisma } from '@bot/db';
import { ButtonStyle, ComponentType, DiscordAPIError, RESTJSONErrorCodes, Routes, type APIEmbed } from 'discord.js';
import { z } from 'zod';
import type { GiveawayDto, GiveawayInput, GiveawaysConfig } from './config.js';

type Services = Pick<CoreServices, 'db' | 'rest' | 'scheduler' | 'logger' | 'i18n' | 'guildLocales'>;
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** customId prefix: `gw:join:<giveawayId>`. */
export const PREFIX = 'gw';
export const endKey = (id: string) => `giveaways:end:${id}`;

const Ids = z.array(z.string());

export function toGiveawayDto(row: Giveaway): GiveawayDto {
  return {
    id: row.id,
    channelId: row.channelId,
    messageId: row.messageId,
    prize: row.prize,
    description: row.description,
    winners: row.winners,
    endsAt: row.endsAt.toISOString(),
    hostId: row.hostId,
    requiredRoleIds: Ids.parse(row.requiredRoleIds),
    minMemberDays: row.minMemberDays,
    status: row.status as GiveawayDto['status'],
    winnerIds: Ids.parse(row.winnerIds),
    entries: row.entries,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `count` distinct entrants drawn at random (crypto), leaving out those excluded. */
export function draw(entrants: readonly string[], count: number, excluded: ReadonlySet<string> = new Set(), random: (max: number) => number = randomInt): string[] {
  const pool = entrants.filter((id) => !excluded.has(id));
  const winners: string[] = [];
  while (winners.length < count && pool.length > 0) winners.push(pool.splice(random(pool.length), 1)[0]!);
  return winners;
}

export class GiveawayService {
  constructor(private readonly services: Services) {}

  async translator(guildId: string): Promise<Translate> {
    const locale = await this.services.guildLocales.get(guildId);
    return (key, vars) => this.services.i18n.t(locale, key, vars);
  }

  embed(t: Translate, giveaway: GiveawayDto, config: GiveawaysConfig): APIEmbed {
    const ends = `<t:${Math.floor(Date.parse(giveaway.endsAt) / 1000)}:R>`;
    const lines = [
      giveaway.description,
      giveaway.status === 'running' ? t('giveaways.embed.ends', { time: ends }) : t('giveaways.embed.ended', { time: ends }),
      t('giveaways.embed.host', { user: `<@${giveaway.hostId}>` }),
      t('giveaways.embed.winners', { count: giveaway.winners }),
      giveaway.requiredRoleIds.length > 0 ? t('giveaways.embed.roles', { roles: giveaway.requiredRoleIds.map((id) => `<@&${id}>`).join(', ') }) : null,
      giveaway.minMemberDays > 0 ? t('giveaways.embed.days', { days: giveaway.minMemberDays }) : null,
      giveaway.status === 'ended'
        ? t('giveaways.embed.result', { users: giveaway.winnerIds.map((id) => `<@${id}>`).join(', ') || t('giveaways.nobody') })
        : giveaway.status === 'cancelled'
          ? t('giveaways.embed.cancelled')
          : null,
    ];
    return {
      title: `🎉 ${giveaway.prize}`,
      description: lines.filter(Boolean).join('\n'),
      color: giveaway.status === 'running' ? config.color : 0x99aab5,
      footer: { text: t('giveaways.embed.entries', { count: giveaway.entries }) },
    };
  }

  body(t: Translate, giveaway: GiveawayDto, config: GiveawaysConfig) {
    return {
      embeds: [this.embed(t, giveaway, config)],
      components:
        giveaway.status === 'running'
          ? [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Primary, emoji: { name: '🎉' }, label: t('giveaways.join'), custom_id: `${PREFIX}:join:${giveaway.id}` }] }]
          : [],
      allowed_mentions: { parse: [] },
    };
  }

  async find(guildId: string, id: string): Promise<Giveaway> {
    const row = await this.services.db.giveaway.findUnique({ where: { id } });
    if (!row || row.guildId !== guildId) throw HttpError.notFound('Giveaway not found');
    return row;
  }

  async start(guildId: string, input: GiveawayInput, hostId: string, config: GiveawaysConfig): Promise<Giveaway> {
    const { db, rest, scheduler } = this.services;
    const endsAt = new Date(input.endsAt);
    if (endsAt.getTime() < Date.now() + 60_000) throw HttpError.badRequest('A giveaway lasts at least a minute', [{ path: ['endsAt'], message: 'Too soon' }]);
    const row = await db.giveaway.create({
      data: {
        guildId,
        channelId: input.channelId,
        prize: input.prize,
        description: input.description,
        winners: input.winners,
        endsAt,
        hostId,
        requiredRoleIds: input.requiredRoleIds as Prisma.InputJsonValue,
        minMemberDays: input.minMemberDays,
      },
    });
    const t = await this.translator(guildId);
    const posted = (await rest.post(Routes.channelMessages(input.channelId), { body: this.body(t, toGiveawayDto(row), config) })) as { id: string };
    await scheduler.schedule({ guildId, moduleId: 'giveaways', job: 'end', payload: { id: row.id }, runAt: endsAt, key: endKey(row.id) });
    return db.giveaway.update({ where: { id: row.id }, data: { messageId: posted.id } });
  }

  /** Enters or leaves; returns whether the member is in now. */
  async toggleEntry(giveaway: Giveaway, userId: string): Promise<boolean> {
    const { db } = this.services;
    const key = { giveawayId_userId: { giveawayId: giveaway.id, userId } };
    if (await db.giveawayEntry.findUnique({ where: key })) {
      await db.giveawayEntry.delete({ where: key });
      await db.giveaway.update({ where: { id: giveaway.id }, data: { entries: { decrement: 1 } } });
      return false;
    }
    await db.giveawayEntry.create({ data: { giveawayId: giveaway.id, userId } });
    await db.giveaway.update({ where: { id: giveaway.id }, data: { entries: { increment: 1 } } });
    return true;
  }

  /** Puts the current state on the message. */
  async refresh(giveaway: Giveaway, config: GiveawaysConfig): Promise<void> {
    if (!giveaway.messageId) return;
    const t = await this.translator(giveaway.guildId);
    await this.services.rest
      .patch(Routes.channelMessage(giveaway.channelId, giveaway.messageId), { body: this.body(t, toGiveawayDto(giveaway), config) })
      .catch((err: unknown) => {
        if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage)) throw err;
      });
  }

  /** Draws the winners and announces them; `count` — a reroll of that many new winners. */
  async end(giveaway: Giveaway, config: GiveawaysConfig, { reroll }: { reroll?: number } = {}): Promise<Giveaway> {
    const { db, rest, scheduler, logger } = this.services;
    if (giveaway.status === 'cancelled') throw HttpError.badRequest('The giveaway was cancelled');
    if (!reroll && giveaway.status === 'ended') throw HttpError.badRequest('The giveaway has ended already');
    if (reroll && giveaway.status !== 'ended') throw HttpError.badRequest('Only an ended giveaway can be rerolled');

    const entrants = (await db.giveawayEntry.findMany({ where: { giveawayId: giveaway.id }, select: { userId: true } })).map((e) => e.userId);
    const previous = Ids.parse(giveaway.winnerIds);
    const winners = draw(entrants, reroll ?? giveaway.winners, new Set(previous));
    const updated = await db.giveaway.update({
      where: { id: giveaway.id },
      data: { status: 'ended', winnerIds: [...previous, ...winners] as Prisma.InputJsonValue, ...(reroll ? {} : { endsAt: new Date() }) },
    });
    await scheduler.cancel(endKey(giveaway.id));
    await this.refresh(updated, config);

    const t = await this.translator(giveaway.guildId);
    const mentions = winners.map((id) => `<@${id}>`).join(', ');
    await rest.post(Routes.channelMessages(giveaway.channelId), {
      body: {
        content: winners.length > 0 ? t(reroll ? 'giveaways.rerolled' : 'giveaways.won', { users: mentions, prize: giveaway.prize }) : t('giveaways.noEntries', { prize: giveaway.prize }),
        allowed_mentions: { users: winners },
        ...(giveaway.messageId ? { message_reference: { message_id: giveaway.messageId, fail_if_not_exists: false } } : {}),
      },
    });
    if (config.dmWinners) {
      for (const userId of winners) {
        try {
          const dm = (await rest.post(Routes.userChannels(), { body: { recipient_id: userId } })) as { id: string };
          await rest.post(Routes.channelMessages(dm.id), { body: { content: t('giveaways.dm', { prize: giveaway.prize, channel: `<#${giveaway.channelId}>` }) } });
        } catch (err) {
          logger.debug({ err, userId }, 'Giveaway DM not delivered');
        }
      }
    }
    return updated;
  }

  async cancel(giveaway: Giveaway, config: GiveawaysConfig): Promise<Giveaway> {
    if (giveaway.status !== 'running') throw HttpError.badRequest('Only a running giveaway can be cancelled');
    const updated = await this.services.db.giveaway.update({ where: { id: giveaway.id }, data: { status: 'cancelled' } });
    await this.services.scheduler.cancel(endKey(giveaway.id));
    await this.refresh(updated, config);
    return updated;
  }

  async delete(giveaway: Giveaway): Promise<void> {
    await this.services.scheduler.cancel(endKey(giveaway.id));
    if (giveaway.messageId) await this.services.rest.delete(Routes.channelMessage(giveaway.channelId, giveaway.messageId)).catch(() => undefined);
    await this.services.db.giveawayEntry.deleteMany({ where: { giveawayId: giveaway.id } });
    await this.services.db.giveaway.delete({ where: { id: giveaway.id } });
  }
}
