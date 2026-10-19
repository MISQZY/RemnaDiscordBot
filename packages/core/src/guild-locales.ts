import type { Locale } from '@bot/contracts';
import type { PrismaClient } from '@bot/db';
import type { I18n } from '@bot/i18n';
import { LRUCache } from 'lru-cache';

/**
 * Guild language (`Guild.locale`) — for the bot's public messages: logs, announcements,
 * moderation results. Private replies use the user's language.
 * The cache is dropped by guild invalidation (`config:invalidate` without `moduleId`).
 */
export class GuildLocales {
  private readonly cache = new LRUCache<string, Locale>({ max: 50_000, ttl: 10 * 60_000 });

  constructor(
    private readonly db: PrismaClient,
    private readonly i18n: I18n,
  ) {}

  async get(guildId: string): Promise<Locale> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = await this.db.guild.findUnique({ where: { id: guildId }, select: { locale: true } });
    const locale = this.i18n.resolveLocale(row?.locale);
    this.cache.set(guildId, locale);
    return locale;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
