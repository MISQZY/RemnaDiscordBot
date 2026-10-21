import type { CoreServices } from '@bot/core';
import type { ChannelLockdown } from '@bot/db';
import { ChannelType, DiscordAPIError, OverwriteType, PermissionFlagsBits, RESTJSONErrorCodes, Routes, type APIChannel, type APIOverwrite } from 'discord.js';

/** What a lockdown takes from @everyone: writing, threads and reactions. Reading stays. */
export const LOCK_BITS =
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.CreatePrivateThreads |
  PermissionFlagsBits.AddReactions;

/** Channels with a chat a lockdown closes. */
const LOCKABLE_TYPES: number[] = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice];

export const unlockKey = (guildId: string, scope: string) => `moderation:unlock:${guildId}:${scope}`;

export interface LockResult {
  locked: string[];
  /** Already locked before — left as they are. */
  skipped: string[];
  /** The bot could not change them (no Manage Roles / Manage Channels there). */
  failed: string[];
}

/**
 * Computes the @everyone overwrite of a locked channel and what to remember to undo it:
 * the bits added to deny and the ones taken out of allow (the overwrite is kept otherwise).
 */
export function lockOverwrite(current: { allow: bigint; deny: bigint } | null) {
  const allow = current?.allow ?? 0n;
  const deny = current?.deny ?? 0n;
  return {
    allow: allow & ~LOCK_BITS,
    deny: deny | LOCK_BITS,
    addedDeny: LOCK_BITS & ~deny,
    removedAllow: allow & LOCK_BITS,
  };
}

/** The overwrite after unlocking: only what the lockdown changed is put back, later edits stay. */
export function unlockOverwrite(current: { allow: bigint; deny: bigint } | null, row: Pick<ChannelLockdown, 'addedDeny' | 'removedAllow'>) {
  return {
    allow: (current?.allow ?? 0n) | BigInt(row.removedAllow),
    deny: (current?.deny ?? 0n) & ~BigInt(row.addedDeny),
  };
}

const everyoneOf = (channel: APIChannel, guildId: string) => {
  const overwrite = 'permission_overwrites' in channel ? channel.permission_overwrites?.find((o: APIOverwrite) => o.id === guildId) : undefined;
  return overwrite ? { allow: BigInt(overwrite.allow), deny: BigInt(overwrite.deny) } : null;
};

const isDiscordError = (err: unknown, ...codes: number[]) => err instanceof DiscordAPIError && codes.includes(err.code as number);

/**
 * Lockdown of channels via Discord REST — the same in the bot, the API and the worker. Works on the channel's
 * @everyone overwrite: a deny there beats what server roles grant, while staff roles with their own allow keep writing.
 */
export class LockdownService {
  constructor(private readonly services: Pick<CoreServices, 'db' | 'rest' | 'scheduler' | 'logger'>) {}

  /** Text, announcement, forum and voice channels everyone can see — what a server lockdown closes by default. */
  async serverChannels(guildId: string): Promise<string[]> {
    const channels = (await this.services.rest.get(Routes.guildChannels(guildId))) as APIChannel[];
    return channels
      .filter((c) => LOCKABLE_TYPES.includes(c.type))
      .filter((c) => !((everyoneOf(c, guildId)?.deny ?? 0n) & PermissionFlagsBits.ViewChannel))
      .map((c) => c.id);
  }

  async lock(guildId: string, channelIds: readonly string[], { reason, until, scope }: { reason: string; until: Date | null; scope: string }): Promise<LockResult> {
    const { db, rest, scheduler, logger } = this.services;
    const result: LockResult = { locked: [], skipped: [], failed: [] };
    const already = new Set((await db.channelLockdown.findMany({ where: { guildId, channelId: { in: [...channelIds] } } })).map((r) => r.channelId));

    for (const channelId of channelIds) {
      if (already.has(channelId)) {
        result.skipped.push(channelId);
        continue;
      }
      try {
        const current = everyoneOf((await rest.get(Routes.channel(channelId))) as APIChannel, guildId);
        const next = lockOverwrite(current);
        await rest.put(Routes.channelPermission(channelId, guildId), {
          body: { type: OverwriteType.Role, allow: next.allow.toString(), deny: next.deny.toString() },
          reason,
        });
        await db.channelLockdown.create({
          data: { guildId, channelId, addedDeny: next.addedDeny.toString(), removedAllow: next.removedAllow.toString(), hadOverwrite: current !== null, endsAt: until },
        });
        result.locked.push(channelId);
      } catch (err) {
        logger.warn({ err, guildId, channelId }, 'Lockdown of a channel failed');
        result.failed.push(channelId);
      }
    }

    if (until && result.locked.length > 0) {
      await scheduler.schedule({
        guildId,
        moduleId: 'moderation',
        job: 'unlock',
        payload: { channelIds: result.locked },
        runAt: until,
        key: unlockKey(guildId, scope),
      });
    }
    return result;
  }

  /** Unlocks the channels; without ids — every channel the bot locked on the server. Returns the unlocked ones. */
  async unlock(guildId: string, channelIds: readonly string[] | null, { reason, scope }: { reason: string; scope?: string }): Promise<string[]> {
    const { db, rest, scheduler, logger } = this.services;
    const rows = await db.channelLockdown.findMany({ where: { guildId, ...(channelIds ? { channelId: { in: [...channelIds] } } : {}) } });
    const unlocked: string[] = [];

    for (const row of rows) {
      try {
        const current = everyoneOf((await rest.get(Routes.channel(row.channelId))) as APIChannel, guildId);
        const next = unlockOverwrite(current, row);
        if (!row.hadOverwrite && next.allow === 0n && next.deny === 0n) {
          await rest.delete(Routes.channelPermission(row.channelId, guildId), { reason });
        } else {
          await rest.put(Routes.channelPermission(row.channelId, guildId), {
            body: { type: OverwriteType.Role, allow: next.allow.toString(), deny: next.deny.toString() },
            reason,
          });
        }
        unlocked.push(row.channelId);
      } catch (err) {
        // A deleted channel has nothing to unlock; anything else stays locked to retry.
        if (!isDiscordError(err, RESTJSONErrorCodes.UnknownChannel)) {
          logger.warn({ err, guildId, channelId: row.channelId }, 'Unlock of a channel failed');
          continue;
        }
      }
      await db.channelLockdown.delete({ where: { guildId_channelId: { guildId, channelId: row.channelId } } });
    }

    if (scope) await scheduler.cancel(unlockKey(guildId, scope));
    else if (!channelIds) {
      await db.scheduledAction.deleteMany({ where: { guildId, type: 'moderation:unlock', doneAt: null } });
    }
    return unlocked;
  }

  locked(guildId: string): Promise<ChannelLockdown[]> {
    return this.services.db.channelLockdown.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
  }
}
