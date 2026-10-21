import type { CoreServices } from '@bot/core';
import { LockdownService } from '@bot/module-moderation';
import { Routes, type Guild, type GuildMember } from 'discord.js';
import type { AutomodConfig } from './config.js';
import { punish, type Punishment } from './punish.js';
import { recordInWindow } from './window.js';

type Services = Pick<CoreServices, 'db' | 'rest' | 'redis' | 'scheduler' | 'i18n' | 'logger' | 'bus' | 'config' | 'guildLocales'>;

/** Lockdown scope of raid mode: its channels are unlocked together. */
export const RAID_SCOPE = 'automod-raid';
export const raidKey = (guildId: string) => `automod:raid:${guildId}`;
const joinsKey = (guildId: string) => `automod:joins:${guildId}`;

/** Discord pauses invites for at most a day. */
const MAX_INVITE_PAUSE_MS = 24 * 3600_000;

async function translator(services: Services, guildId: string) {
  const locale = await services.guildLocales.get(guildId);
  return (key: string, vars?: Record<string, string | number>) => services.i18n.t(locale, key, vars);
}

const joinPunishment = (action: AutomodConfig['raid']['joinAction'] | AutomodConfig['accountAge']['action']): Punishment =>
  action === 'timeout' ? 'mute' : action;

async function alert(services: Services, guild: Guild, config: AutomodConfig, text: string): Promise<void> {
  const channelId = config.raid.alertChannelId ?? config.logChannelId;
  if (!channelId) return;
  const role = config.raid.alertRoleId;
  await services.rest
    .post(Routes.channelMessages(channelId), {
      body: { content: role ? `<@&${role}> ${text}` : text, allowed_mentions: { roles: role ? [role] : [] } },
    })
    .catch((err: unknown) => services.logger.warn({ err, guildId: guild.id }, 'Raid alert not delivered'));
}

/** Records the join; returns the members who joined within the window when it is over the limit. */
export async function countJoin(services: Pick<Services, 'redis'>, guildId: string, userId: string, raid: AutomodConfig['raid'], now = Date.now()): Promise<string[] | null> {
  const key = joinsKey(guildId);
  const members = await recordInWindow(services.redis, key, userId, { limit: raid.joins, windowMs: raid.seconds * 1000, now });
  return members.length >= raid.joins ? members : null;
}

/** Turns raid mode on once: lockdown, paused invites, an alert. Returns false when it is on already. */
export async function startRaid(services: Services, guild: Guild, config: AutomodConfig, joined: readonly string[]): Promise<boolean> {
  const durationMs = config.raid.durationMin * 60_000;
  const started = await services.redis.set(raidKey(guild.id), String(Date.now() + durationMs), 'PX', durationMs, 'NX');
  if (!started) return false;
  const t = await translator(services, guild.id);
  const until = new Date(Date.now() + durationMs);

  if (config.raid.lockdown) {
    const lockdown = new LockdownService(services);
    const moderation = (await services.config.get<{ lockdown: { channelIds: string[] } }>(guild.id, 'moderation')).config;
    const channelIds = moderation.lockdown.channelIds.length > 0 ? moderation.lockdown.channelIds : await lockdown.serverChannels(guild.id);
    await lockdown.lock(guild.id, channelIds, { reason: 'Automod: raid detected', until, scope: RAID_SCOPE });
  }
  if (config.raid.pauseInvites) {
    const pausedUntil = new Date(Date.now() + Math.min(durationMs, MAX_INVITE_PAUSE_MS));
    await services.rest
      .put(Routes.guildIncidentActions(guild.id), { body: { invites_disabled_until: pausedUntil.toISOString() }, reason: 'Automod: raid detected' })
      .catch((err: unknown) => services.logger.warn({ err, guildId: guild.id }, 'Could not pause invites'));
  }

  // The joins that set it off are the raid too.
  if (config.raid.joinAction !== 'none') {
    for (const userId of joined) {
      const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
      if (member) await punish(services, member, joinPunishment(config.raid.joinAction), { reason: t('automod.raid.reason'), durationSec: config.raid.durationMin * 60 });
    }
  }

  await alert(
    services,
    guild,
    config,
    [
      t('automod.raid.started', { count: joined.length, seconds: config.raid.seconds }),
      config.raid.lockdown ? t('automod.raid.locked') : null,
      config.raid.pauseInvites ? t('automod.raid.invitesPaused') : null,
      t('automod.raid.until', { time: `<t:${Math.floor(until.getTime() / 1000)}:R>` }),
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return true;
}

/** Ends raid mode early: unlocks its channels and lets invites work again. */
export async function endRaid(services: Services, guildId: string): Promise<boolean> {
  const was = await services.redis.del(raidKey(guildId));
  await new LockdownService(services).unlock(guildId, null, { reason: 'Automod: raid mode ended', scope: RAID_SCOPE });
  await services.rest.put(Routes.guildIncidentActions(guildId), { body: { invites_disabled_until: null } }).catch(() => undefined);
  return was > 0;
}

/** New member: account age, raid mode and counting joins toward it. */
export async function onMemberJoin(services: Services & { getConfig(guildId: string): Promise<AutomodConfig> }, member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  const config = await services.getConfig(member.guild.id);
  const t = await translator(services, member.guild.id);

  if (config.accountAge.enabled) {
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
    if (ageDays < config.accountAge.minDays) {
      // A timeout lasts until the account is old enough, at most Discord's 28 days.
      const durationSec = Math.min(28 * 86_400, Math.ceil((config.accountAge.minDays - ageDays) * 86_400));
      await punish(services, member, joinPunishment(config.accountAge.action), { reason: t('automod.accountAge.reason', { days: config.accountAge.minDays }), durationSec });
      return;
    }
  }

  if (!config.raid.enabled) return;
  if (await services.redis.exists(raidKey(member.guild.id))) {
    if (config.raid.joinAction !== 'none') {
      await punish(services, member, joinPunishment(config.raid.joinAction), { reason: t('automod.raid.reason'), durationSec: config.raid.durationMin * 60 });
    }
    return;
  }
  const joined = await countJoin(services, member.guild.id, member.id, config.raid);
  if (joined) await startRaid(services, member.guild, config, joined);
}
