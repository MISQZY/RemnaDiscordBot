import type { PrismaClient, MemberLevel } from '@bot/db';
import { toEntry, type LeaderboardEntry, type LevelingConfig } from './config.js';
import { levelFromXp } from './formula.js';

export interface Profile {
  username?: string | null;
  avatar?: string | null;
}

export interface XpChange {
  row: MemberLevel;
  previousLevel: number;
  leveledUp: boolean;
}

/** Опыт и лидерборд. Начисление — атомарный инкремент, без гонок между кластерами. */
export class LevelingService {
  constructor(private readonly db: PrismaClient) {}

  async addXp(guildId: string, userId: string, amount: number, profile: Profile = {}, { countMessage = false } = {}): Promise<XpChange> {
    const row = await this.db.memberLevel.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, xp: Math.max(amount, 0), messages: countMessage ? 1 : 0, ...profile },
      update: { xp: { increment: amount }, ...(countMessage ? { messages: { increment: 1 } } : {}), ...profile },
    });
    return this.syncLevel(row);
  }

  async setXp(guildId: string, userId: string, xp: number): Promise<XpChange> {
    const row = await this.db.memberLevel.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, xp },
      update: { xp },
    });
    return this.syncLevel(row);
  }

  async get(guildId: string, userId: string): Promise<MemberLevel | null> {
    return this.db.memberLevel.findUnique({ where: { guildId_userId: { guildId, userId } } });
  }

  /** Место в рейтинге: 1 + число участников с большим опытом. */
  async rankOf(guildId: string, xp: number): Promise<number> {
    return 1 + (await this.db.memberLevel.count({ where: { guildId, xp: { gt: xp } } }));
  }

  async leaderboard(guildId: string, page: number, limit: number): Promise<{ items: LeaderboardEntry[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db.memberLevel.findMany({
        where: { guildId, xp: { gt: 0 } },
        orderBy: [{ xp: 'desc' }, { userId: 'asc' }],
        skip: page * limit,
        take: limit,
      }),
      this.db.memberLevel.count({ where: { guildId, xp: { gt: 0 } } }),
    ]);
    return { items: rows.map((row, i) => toEntry(row, page * limit + i + 1)), total };
  }

  async reset(guildId: string, userId?: string): Promise<number> {
    const { count } = await this.db.memberLevel.deleteMany({ where: { guildId, ...(userId ? { userId } : {}) } });
    return count;
  }

  private async syncLevel(row: MemberLevel): Promise<XpChange> {
    const level = levelFromXp(row.xp);
    if (level === row.level) return { row, previousLevel: row.level, leveledUp: false };
    const updated = await this.db.memberLevel.update({
      where: { guildId_userId: { guildId: row.guildId, userId: row.userId } },
      data: { level },
    });
    return { row: updated, previousLevel: row.level, leveledUp: level > row.level };
  }
}

/** Какие роли-награды выдать и снять для уровня. */
export function rewardChanges(level: number, config: Pick<LevelingConfig, 'rewards' | 'stackRewards'>): { add: string[]; remove: string[] } {
  const reached = config.rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  const notReached = config.rewards.filter((r) => r.level > level).map((r) => r.roleId);
  if (config.stackRewards) return { add: reached.map((r) => r.roleId), remove: notReached };

  const top = reached.at(-1)?.roleId;
  return {
    add: top ? [top] : [],
    remove: config.rewards.map((r) => r.roleId).filter((id) => id !== top),
  };
}

/** Опыт за сообщение с учётом множителей: наибольший по ролям × канал. */
export function messageXp(
  config: Pick<LevelingConfig, 'xpPerMessage' | 'multipliers'>,
  { roleIds, channelId }: { roleIds: readonly string[]; channelId: string },
  random: () => number = Math.random,
): number {
  const { min, max } = config.xpPerMessage;
  const base = min + Math.floor(random() * (max - min + 1));
  const roleMultipliers = config.multipliers.filter((m) => m.type === 'role' && roleIds.includes(m.id)).map((m) => m.value);
  const roleMultiplier = roleMultipliers.length > 0 ? Math.max(...roleMultipliers) : 1;
  const channelMultiplier = config.multipliers.find((m) => m.type === 'channel' && m.id === channelId)?.value ?? 1;
  return Math.round(base * roleMultiplier * channelMultiplier);
}
