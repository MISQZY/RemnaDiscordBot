import { HttpError, type CoreServices } from '@bot/core';
import type { Suggestion } from '@bot/db';
import { ButtonStyle, ChannelType, ComponentType, Routes, type APIEmbed } from 'discord.js';
import type { SuggestionDto, SuggestionsConfig, SuggestionStatus } from './config.js';

type Services = Pick<CoreServices, 'db' | 'rest' | 'logger' | 'i18n' | 'guildLocales'>;
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** customId prefix: `sg:up:<id>`, `sg:down:<id>`. */
export const PREFIX = 'sg';

const COLORS: Record<SuggestionStatus, number> = { pending: 0x5865f2, considered: 0xf0a020, approved: 0x3ba55d, denied: 0xd83c3e, implemented: 0x2ecc71 };
/** Voting stays open until a final decision. */
export const isFinal = (status: SuggestionStatus) => status === 'approved' || status === 'denied' || status === 'implemented';

export function toSuggestionDto(row: Suggestion): SuggestionDto {
  return {
    number: row.number,
    authorId: row.authorId,
    content: row.content,
    channelId: row.channelId,
    messageId: row.messageId,
    status: row.status as SuggestionStatus,
    reviewerId: row.reviewerId,
    response: row.response,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function suggestionMessage(t: Translate, row: Pick<Suggestion, 'id' | 'number' | 'authorId' | 'content' | 'status' | 'reviewerId' | 'response' | 'upvotes' | 'downvotes'>, config: Pick<SuggestionsConfig, 'anonymous'>) {
  const status = row.status as SuggestionStatus;
  const embed: APIEmbed = {
    title: t('suggestions.embed.title', { number: row.number }),
    description: row.content,
    color: COLORS[status],
    fields: [
      ...(config.anonymous ? [] : [{ name: t('suggestions.embed.author'), value: `<@${row.authorId}>`, inline: true }]),
      { name: t('suggestions.embed.status'), value: t(`suggestions.statuses.${status}`), inline: true },
      ...(row.reviewerId ? [{ name: t('suggestions.embed.reviewer'), value: `<@${row.reviewerId}>`, inline: true }] : []),
      ...(row.response ? [{ name: t('suggestions.embed.response'), value: row.response.slice(0, 1024) }] : []),
    ],
  };
  const disabled = isFinal(status);
  return {
    embeds: [embed],
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, style: ButtonStyle.Success, emoji: { name: '👍' }, label: String(row.upvotes), custom_id: `${PREFIX}:up:${row.id}`, disabled },
          { type: ComponentType.Button, style: ButtonStyle.Danger, emoji: { name: '👎' }, label: String(row.downvotes), custom_id: `${PREFIX}:down:${row.id}`, disabled },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export class SuggestionService {
  constructor(private readonly services: Services) {}

  async translator(guildId: string): Promise<Translate> {
    const locale = await this.services.guildLocales.get(guildId);
    return (key, vars) => this.services.i18n.t(locale, key, vars);
  }

  async create(guildId: string, authorId: string, content: string, config: SuggestionsConfig): Promise<Suggestion> {
    const { db, rest } = this.services;
    if (!config.channelId) throw HttpError.badRequest('Suggestions have no channel');
    const counter = await db.suggestionCounter.upsert({ where: { guildId }, create: { guildId, last: 1 }, update: { last: { increment: 1 } } });
    const row = await db.suggestion.create({ data: { guildId, number: counter.last, authorId, content, channelId: config.channelId } });
    const t = await this.translator(guildId);
    const posted = (await rest.post(Routes.channelMessages(config.channelId), { body: suggestionMessage(t, row, config) })) as { id: string };
    if (config.threads) {
      await rest
        .post(Routes.threads(config.channelId, posted.id), { body: { name: t('suggestions.thread', { number: row.number }), auto_archive_duration: 10_080, type: ChannelType.PublicThread } })
        .catch((err: unknown) => this.services.logger.debug({ err }, 'Suggestion thread not created'));
    }
    return db.suggestion.update({ where: { id: row.id }, data: { messageId: posted.id } });
  }

  /** Casts, changes or takes back a vote; returns the suggestion with the new counts. */
  async vote(suggestion: Suggestion, userId: string, value: 1 | -1): Promise<Suggestion> {
    const { db } = this.services;
    const key = { suggestionId_userId: { suggestionId: suggestion.id, userId } };
    const current = await db.suggestionVote.findUnique({ where: key });
    if (current?.value === value) await db.suggestionVote.delete({ where: key });
    else await db.suggestionVote.upsert({ where: key, create: { suggestionId: suggestion.id, userId, value }, update: { value } });
    const [upvotes, downvotes] = await Promise.all([
      db.suggestionVote.count({ where: { suggestionId: suggestion.id, value: 1 } }),
      db.suggestionVote.count({ where: { suggestionId: suggestion.id, value: -1 } }),
    ]);
    return db.suggestion.update({ where: { id: suggestion.id }, data: { upvotes, downvotes } });
  }

  async decide(guildId: string, number: number, status: SuggestionStatus, reviewerId: string, response: string | null, config: SuggestionsConfig): Promise<Suggestion> {
    const { db, rest, logger } = this.services;
    const row = await db.suggestion.findUnique({ where: { guildId_number: { guildId, number } } });
    if (!row) throw HttpError.notFound('Suggestion not found');
    const updated = await db.suggestion.update({ where: { id: row.id }, data: { status, reviewerId: status === 'pending' ? null : reviewerId, response } });
    const t = await this.translator(guildId);
    if (updated.messageId) {
      await rest.patch(Routes.channelMessage(updated.channelId, updated.messageId), { body: suggestionMessage(t, updated, config) }).catch((err: unknown) => logger.warn({ err }, 'Suggestion message not updated'));
    }
    if (config.dmOnDecision && status !== 'pending') {
      try {
        const dm = (await rest.post(Routes.userChannels(), { body: { recipient_id: row.authorId } })) as { id: string };
        await rest.post(Routes.channelMessages(dm.id), {
          body: { content: t('suggestions.dm', { number, status: t(`suggestions.statuses.${status}`), response: response ?? '—' }), allowed_mentions: { parse: [] } },
        });
      } catch (err) {
        logger.debug({ err }, 'Suggestion DM not delivered');
      }
    }
    return updated;
  }
}
