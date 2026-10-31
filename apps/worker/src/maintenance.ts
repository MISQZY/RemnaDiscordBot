import type { CoreServices } from '@bot/core';
import type { PrismaClient } from '@bot/db';

const DAY_MS = 86_400_000;
const EVERY_MS = 60 * 60_000;
const LOCK_KEY = 'lock:maintenance';

/**
 * Deletes everything stored for guilds the bot left more than `retentionDays` ago.
 * The grace period keeps the settings for a bot that gets re-added soon after.
 */
export async function purgeLeftGuilds(db: PrismaClient, retentionDays: number, now = new Date()): Promise<string[]> {
  const guilds = await db.guild.findMany({ where: { leftAt: { lt: new Date(now.getTime() - retentionDays * DAY_MS) } }, select: { id: true } });
  for (const { id: guildId } of guilds) {
    const where = { guildId };
    const giveaways = await db.giveaway.findMany({ where, select: { id: true } });
    if (giveaways.length > 0) {
      await db.giveawayEntry.deleteMany({ where: { giveawayId: { in: giveaways.map((g) => g.id) } } });
    }
    const suggestions = await db.suggestion.findMany({ where, select: { id: true } });
    if (suggestions.length > 0) {
      await db.suggestionVote.deleteMany({ where: { suggestionId: { in: suggestions.map((s) => s.id) } } });
    }
    await db.$transaction([
      db.dashboardAuditLog.deleteMany({ where }),
      db.scheduledAction.deleteMany({ where }),
      db.rolePanel.deleteMany({ where }),
      db.infoPanel.deleteMany({ where }),
      db.memberRoleBackup.deleteMany({ where }),
      db.modCase.deleteMany({ where }),
      db.modCaseCounter.deleteMany({ where: { guildId } }),
      db.channelLockdown.deleteMany({ where }),
      db.verificationPanel.deleteMany({ where: { guildId } }),
      db.ticketPanel.deleteMany({ where }),
      db.ticket.deleteMany({ where }),
      db.ticketCounter.deleteMany({ where: { guildId } }),
      db.botMessage.deleteMany({ where }),
      db.scheduledMessage.deleteMany({ where }),
      db.stickyMessage.deleteMany({ where }),
      db.reminder.deleteMany({ where }),
      db.tempVoiceChannel.deleteMany({ where }),
      db.giveaway.deleteMany({ where }),
      db.memberInvite.deleteMany({ where }),
      db.suggestion.deleteMany({ where }),
      db.suggestionCounter.deleteMany({ where: { guildId } }),
      db.starboardEntry.deleteMany({ where }),
      db.memberLevel.deleteMany({ where }),
      db.customCommand.deleteMany({ where }),
      db.notificationSubscription.deleteMany({ where }),
      db.guildVip.deleteMany({ where: { guildId } }),
      // Module configs go with the guild row (cascade).
      db.guild.delete({ where: { id: guildId } }),
    ]);
  }
  if (guilds.length > 0) await db.notificationSource.deleteMany({ where: { subscriptions: { none: {} } } });
  return guilds.map((g) => g.id);
}

/** Done jobs are kept for a while for debugging, then dropped. */
export async function pruneFinishedJobs(db: PrismaClient, keepDays: number, now = new Date()): Promise<number> {
  const { count } = await db.scheduledAction.deleteMany({ where: { doneAt: { lt: new Date(now.getTime() - keepDays * DAY_MS) } } });
  return count;
}

/** Hourly maintenance; one worker at a time runs it (Redis lock). */
export function startMaintenance(
  { db, redis, logger }: Pick<CoreServices, 'db' | 'redis' | 'logger'>,
  { retentionDays, jobHistoryDays }: { retentionDays: number; jobHistoryDays: number },
): () => void {
  const run = async () => {
    try {
      if ((await redis.set(LOCK_KEY, '1', 'PX', EVERY_MS - 60_000, 'NX')) !== 'OK') return;
      const purged = await purgeLeftGuilds(db, retentionDays);
      const pruned = await pruneFinishedJobs(db, jobHistoryDays);
      if (purged.length > 0 || pruned > 0) logger.info({ purgedGuilds: purged, prunedJobs: pruned }, 'Maintenance done');
    } catch (err) {
      logger.error({ err }, 'Maintenance failed');
    }
  };
  const first = setTimeout(() => void run(), 30_000);
  const timer = setInterval(() => void run(), EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
