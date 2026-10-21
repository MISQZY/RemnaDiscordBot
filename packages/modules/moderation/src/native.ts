import type { BotModuleContext } from '@bot/core';
import { AuditLogEvent, type Guild, type GuildAuditLogsEntry } from 'discord.js';
import type { CaseType, ModerationConfig } from './config.js';
import { ModerationService } from './service.js';

type NativeCase = { type: Exclude<CaseType, 'warn' | 'note'>; durationSec: number | null };

/**
 * The case an audit log entry stands for: bans, kicks and timeouts given or lifted in Discord itself.
 * `null` — the entry is about something else.
 */
export function nativeCase(entry: Pick<GuildAuditLogsEntry, 'action' | 'changes'>, now = Date.now()): NativeCase | null {
  switch (entry.action) {
    case AuditLogEvent.MemberBanAdd:
      return { type: 'ban', durationSec: null };
    case AuditLogEvent.MemberBanRemove:
      return { type: 'unban', durationSec: null };
    case AuditLogEvent.MemberKick:
      return { type: 'kick', durationSec: null };
    case AuditLogEvent.MemberUpdate: {
      const change = entry.changes.find((c) => c.key === 'communication_disabled_until');
      if (!change) return null;
      const until = typeof change.new === 'string' ? Date.parse(change.new) : NaN;
      if (Number.isNaN(until)) return { type: 'unmute', durationSec: null };
      const durationSec = Math.ceil((until - now) / 1000);
      return durationSec > 0 ? { type: 'mute', durationSec } : null;
    }
    default:
      return null;
  }
}

/** Records cases for punishments done outside the bot; the bot's own are already cases. */
export async function onAuditLogEntry(ctx: BotModuleContext<ModerationConfig>, entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
  const found = nativeCase(entry);
  if (!found || !entry.targetId || !entry.executorId || entry.executorId === ctx.client.user?.id) return;
  const config = await ctx.getConfig(guild.id);
  if (!config.trackNativeActions) return;
  await new ModerationService(ctx).recordExternal(
    found.type,
    { guildId: guild.id, targetId: entry.targetId, moderatorId: entry.executorId, reason: entry.reason, durationSec: found.durationSec },
    config,
  );
}
