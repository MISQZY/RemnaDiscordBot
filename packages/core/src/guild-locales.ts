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
  private readonly loading = new Map<string, Promise<Locale>>();

  constructor(
    private readonly db: PrismaClient,
    private readonly i18n: I18n,
  ) {}

  async get(guildId: string): Promise<Locale> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    let pending = this.loading.get(guildId);
    if (!pending) {
      pending = this.db.guild.findUnique({ where: { id: guildId }, select: { locale: true } }).then((row) => {
        const locale = this.i18n.resolveLocale(row?.locale);
        if (this.loading.get(guildId) === pending) this.cache.set(guildId, locale);
        return locale;
      }).finally(() => { if (this.loading.get(guildId) === pending) this.loading.delete(guildId); });
      this.loading.set(guildId, pending);
    }
    return pending;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
    this.loading.delete(guildId);
  }
}
