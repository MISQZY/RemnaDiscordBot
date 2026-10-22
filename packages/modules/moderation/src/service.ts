import type { Locale } from '@bot/contracts';
import { HttpError, type CoreServices } from '@bot/core';
import type { ModCase } from '@bot/db';
import { DiscordAPIError, PermissionFlagsBits, RESTJSONErrorCodes, Routes, type APIEmbed, type APIGuild, type PermissionsBitField } from 'discord.js';
import { SYSTEM_MODERATOR, isActive, toCaseDto, type CaseType, type ModerationConfig } from './config.js';
import { formatDuration, MAX_TIMEOUT_SEC } from './duration.js';

export interface ActionInput {
  guildId: string;
  targetId: string;
  moderatorId: string;
  reason?: string | null;
  durationSec?: number | null;
  /** Ban: delete messages from the last N seconds (≤ 7 days). */
  deleteMessageSeconds?: number;
}

declare module '@bot/core' {
  interface BusEvents {
    'moderation.caseCreated': { guildId: string; case: ReturnType<typeof toCaseDto> };
  }
}

const COLORS: Record<CaseType, number> = {
  ban: 0xd83c3e,
  unban: 0x3ba55d,
  kick: 0xf0a020,
  mute: 0xf0a020,
  unmute: 0x3ba55d,
  warn: 0xf5d142,
  note: 0x99aab5,
};

export const unbanKey = (guildId: string, userId: string) => `moderation:unban:${guildId}:${userId}`;

const isDiscordError = (err: unknown, ...codes: number[]) => err instanceof DiscordAPIError && codes.includes(err.code as number);

/**
 * Moderation actions via Discord REST — work the same in the bot, the API and the worker.
 * Role hierarchy checks are done by the caller (the bot); the REST context has none.
 */
/** Whether someone with these permissions could take an escalated action themselves (`warn`'s `mayEscalate`). */
export function escalationAllowed(permissions: Readonly<PermissionsBitField> | null): (action: 'mute' | 'kick' | 'ban') => boolean {
  const needed = { mute: PermissionFlagsBits.ModerateMembers, kick: PermissionFlagsBits.KickMembers, ban: PermissionFlagsBits.BanMembers } as const;
  return (action) => permissions?.has(needed[action]) ?? false;
}

export class ModerationService {
  constructor(private readonly services: Pick<CoreServices, 'db' | 'rest' | 'scheduler' | 'i18n' | 'logger' | 'bus'>) {}

  async ban(input: ActionInput, config: ModerationConfig): Promise<ModCase> {
    const { rest, scheduler } = this.services;
    await this.notify('ban', input, config);
    await rest.put(Routes.guildBan(input.guildId, input.targetId), {
      body: { delete_message_seconds: Math.min(input.deleteMessageSeconds ?? 0, 7 * 86_400) },
      reason: this.auditReason(input),
    });

    const modCase = await this.record('ban', input);
    if (input.durationSec) {
      await scheduler.schedule({
        guildId: input.guildId,
        moduleId: 'moderation',
        job: 'unban',
        payload: { userId: input.targetId },
        runAt: modCase.expiresAt!,
        key: unbanKey(input.guildId, input.targetId),
      });
    }
    return this.finish(modCase, config);
  }

  /**
   * A ban that deletes the member's recent messages and is lifted at once: the member is out and their spam gone, but
   * they may join again. Recorded as a kick — that is what it amounts to.
   */
  async softban(input: ActionInput, config: ModerationConfig): Promise<ModCase> {
    const { rest } = this.services;
    await this.notify('kick', input, config);
    await rest.put(Routes.guildBan(input.guildId, input.targetId), {
      body: { delete_message_seconds: Math.min(input.deleteMessageSeconds ?? 0, 7 * 86_400) },
      reason: this.auditReason(input),
    });
    await rest.delete(Routes.guildBan(input.guildId, input.targetId), { reason: this.auditReason(input) });
    return this.finish(await this.record('kick', { ...input, durationSec: null }), config);
  }

  async unban(input: ActionInput, config: ModerationConfig): Promise<ModCase> {
    try {
      await this.services.rest.delete(Routes.guildBan(input.guildId, input.targetId), { reason: this.auditReason(input) });
    } catch (err) {
      if (!isDiscordError(err, RESTJSONErrorCodes.UnknownBan)) throw err;
      throw HttpError.badRequest('This user is not banned');
    }
    await this.services.scheduler.cancel(unbanKey(input.guildId, input.targetId));
    await this.revokeActive(input, 'ban');
    return this.finish(await this.record('unban', input), config);
  }

  async kick(input: ActionInput, config: ModerationConfig): Promise<ModCase> {
    await this.notify('kick', input, config);
    await this.services.rest.delete(Routes.guildMember(input.guildId, input.targetId), { reason: this.auditReason(input) });
    return this.finish(await this.record('kick', input), config);
  }

  async mute(input: ActionInput, config: ModerationConfig): Promise<ModCase> {
    if (!input.durationSec || input.durationSec > MAX_TIMEOUT_SEC) throw HttpError.badRequest('Mute duration must be up to 28 days');
    await this.services.rest.patch(Routes.guildMember(input.guildId, input.targetId), {
      body: { communication_disabled_until: new Date(Date.now() + input.durationSec * 1000).toISOString() },
      reason: this.auditReason(input),
    });
    await this.notify('mute', input, config);
    return this.finish(await this.record('mute', input), config);
  }

  async unmute(input: ActionInput, config: ModerationConfig): Promise<ModCase> {
    await this.services.rest.patch(Routes.guildMember(input.guildId, input.targetId), {
      body: { communication_disabled_until: null },
      reason: this.auditReason(input),
    });
    await this.revokeActive(input, 'mute');
    return this.finish(await this.record('unmute', input), config);
  }

  /**
   * A warning and auto-escalation by the number of active warnings. `mayEscalate` — whether whoever warns could take
   * the escalated action themselves: someone with Timeout Members alone must not get a member banned by warning them
   * a few times. Left out (automod, the dashboard of a server manager), every rule applies.
   */
  async warn(
    input: ActionInput,
    config: ModerationConfig,
    { mayEscalate = () => true }: { mayEscalate?: (action: 'mute' | 'kick' | 'ban') => boolean } = {},
  ): Promise<{ case: ModCase; escalated: ModCase | null }> {
    await this.notify('warn', input, config);
    const durationSec = config.warnExpiryDays > 0 ? config.warnExpiryDays * 86_400 : null;
    const modCase = await this.finish(await this.record('warn', { ...input, durationSec }), config);

    const count = (await this.activeWarnings(input.guildId, input.targetId)).length;
    const rule = config.escalation.find((r) => r.warns === count);
    if (!rule || !mayEscalate(rule.action)) return { case: modCase, escalated: null };

    const locale = await this.locale(input.guildId);
    const auto: ActionInput = {
      guildId: input.guildId,
      targetId: input.targetId,
      moderatorId: SYSTEM_MODERATOR,
      reason: this.services.i18n.t(locale, 'moderation.escalationReason', { count }),
      durationSec: rule.durationSec,
    };
    const escalated = await this[rule.action](auto, config);
    return { case: modCase, escalated };
  }

  /** A moderator's note: only history, the member is not told. */
  async note(input: ActionInput, config: ModerationConfig): Promise<ModCase> {
    return this.finish(await this.record('note', { ...input, durationSec: null }), config);
  }

  /**
   * A punishment done in Discord itself (its menu, another bot) — seen in the server's audit log. Recorded as a case
   * the same way, without acting or DMing again; lifting one also ends the active case.
   */
  async recordExternal(type: Exclude<CaseType, 'warn' | 'note'>, input: ActionInput, config: ModerationConfig): Promise<ModCase> {
    if (type === 'unban') {
      await this.services.scheduler.cancel(unbanKey(input.guildId, input.targetId));
      await this.revokeActive(input, 'ban');
    }
    if (type === 'unmute') await this.revokeActive(input, 'mute');
    // A new mute replaces the one in effect: Discord keeps only one timeout.
    if (type === 'mute') await this.revokeActive(input, 'mute');
    return this.finish(await this.record(type, input), config);
  }

  /** All of a member's cases, newest first — notes included. */
  history(guildId: string, targetId: string, take = 15): Promise<ModCase[]> {
    return this.services.db.modCase.findMany({ where: { guildId, targetId }, orderBy: { number: 'desc' }, take });
  }

  /** Revoke a punishment by case number. */
  async revoke(guildId: string, number: number, moderatorId: string, reason: string | null, config: ModerationConfig): Promise<ModCase> {
    const modCase = await this.services.db.modCase.findUnique({ where: { guildId_number: { guildId, number } } });
    if (!modCase) throw HttpError.notFound('Case not found');
    if (!isActive(modCase)) throw HttpError.badRequest('This case is not active');

    const input = { guildId, targetId: modCase.targetId, moderatorId, reason };
    switch (modCase.type) {
      case 'ban':
        return this.unban(input, config);
      case 'mute':
        return this.unmute(input, config);
      case 'warn':
        return this.services.db.modCase.update({
          where: { id: modCase.id },
          data: { revokedAt: new Date(), revokedBy: moderatorId, revokeReason: reason },
        });
      default:
        throw HttpError.badRequest(`Cases of type ${modCase.type} cannot be revoked`);
    }
  }

  /** Rewrites the reason of a case, e.g. one created without it. */
  async updateReason(guildId: string, number: number, reason: string): Promise<ModCase> {
    const modCase = await this.services.db.modCase.findUnique({ where: { guildId_number: { guildId, number } } });
    if (!modCase) throw HttpError.notFound('Case not found');
    return this.services.db.modCase.update({ where: { id: modCase.id }, data: { reason } });
  }

  activeWarnings(guildId: string, targetId: string): Promise<ModCase[]> {
    return this.services.db.modCase.findMany({
      where: { guildId, targetId, type: 'warn', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { number: 'asc' },
    });
  }

  async logCase(modCase: ModCase, config: ModerationConfig): Promise<void> {
    if (!config.logChannelId) return;
    const embed = await this.caseEmbed(modCase);
    await this.services.rest
      .post(Routes.channelMessages(config.logChannelId), { body: { embeds: [embed], allowed_mentions: { parse: [] } } })
      .catch((err: unknown) => this.services.logger.warn({ err, guildId: modCase.guildId }, 'Moderation log failed'));
  }

  async caseEmbed(modCase: ModCase): Promise<APIEmbed> {
    const { i18n } = this.services;
    const locale = await this.locale(modCase.guildId);
    const t = (key: string, vars?: Record<string, string | number>) => i18n.t(locale, `moderation.${key}`, vars);
    const moderator = modCase.moderatorId === SYSTEM_MODERATOR ? t('case.system') : `<@${modCase.moderatorId}>`;

    return {
      title: t('case.title', { number: modCase.number, action: t(`actions.${modCase.type}`) }),
      color: COLORS[modCase.type as CaseType],
      fields: [
        { name: t('case.target'), value: `<@${modCase.targetId}> (\`${modCase.targetId}\`)`, inline: true },
        { name: t('case.moderator'), value: moderator, inline: true },
        ...(modCase.durationSec ? [{ name: t('case.duration'), value: formatDuration(modCase.durationSec, locale), inline: true }] : []),
        { name: t('case.reason'), value: modCase.reason || t('case.noReason') },
      ],
      timestamp: modCase.createdAt.toISOString(),
    };
  }

  private async nextNumber(guildId: string): Promise<number> {
    const counter = await this.services.db.modCaseCounter.upsert({
      where: { guildId },
      create: { guildId, last: 1 },
      update: { last: { increment: 1 } },
    });
    return counter.last;
  }

  private async record(type: CaseType, input: ActionInput): Promise<ModCase> {
    return this.services.db.modCase.create({
      data: {
        guildId: input.guildId,
        number: await this.nextNumber(input.guildId),
        type,
        targetId: input.targetId,
        moderatorId: input.moderatorId,
        reason: input.reason ?? null,
        durationSec: input.durationSec ?? null,
        expiresAt: input.durationSec ? new Date(Date.now() + input.durationSec * 1000) : null,
      },
    });
  }

  private async finish(modCase: ModCase, config: ModerationConfig): Promise<ModCase> {
    await this.logCase(modCase, config);
    await this.services.bus.emit('moderation.caseCreated', { guildId: modCase.guildId, case: toCaseDto(modCase) });
    return modCase;
  }

  private async revokeActive(input: ActionInput, type: CaseType): Promise<void> {
    const cases = await this.services.db.modCase.findMany({ where: { guildId: input.guildId, targetId: input.targetId, type, revokedAt: null } });
    const active = cases.filter((c) => isActive(c)).map((c) => c.id);
    if (active.length === 0) return;
    await this.services.db.modCase.updateMany({
      where: { id: { in: active } },
      data: { revokedAt: new Date(), revokedBy: input.moderatorId, revokeReason: input.reason ?? null },
    });
  }

  /** DM the offender before acting (after a kick or ban the bot can no longer write). */
  private async notify(type: CaseType, input: ActionInput, config: ModerationConfig): Promise<void> {
    if (!config.dmOnAction) return;
    const { rest, i18n, logger } = this.services;
    try {
      const locale = await this.locale(input.guildId);
      const guild = (await rest.get(Routes.guild(input.guildId))) as APIGuild;
      const text = [
        i18n.t(locale, `moderation.dm.${type}`, { guild: guild.name }),
        input.durationSec ? i18n.t(locale, 'moderation.dm.duration', { duration: formatDuration(input.durationSec, locale) }) : null,
        input.reason ? i18n.t(locale, 'moderation.dm.reason', { reason: input.reason }) : null,
        config.dmNote.trim() || null,
        config.appealUrl && type !== 'warn' ? i18n.t(locale, 'moderation.dm.appeal', { url: config.appealUrl }) : null,
      ]
        .filter(Boolean)
        .join('\n');
      const channel = (await rest.post(Routes.userChannels(), { body: { recipient_id: input.targetId } })) as { id: string };
      await rest.post(Routes.channelMessages(channel.id), { body: { content: text, allowed_mentions: { parse: [] } } });
    } catch (err) {
      logger.debug({ err, targetId: input.targetId }, 'Moderation DM not delivered');
    }
  }

  private auditReason(input: ActionInput): string {
    const by = input.moderatorId === SYSTEM_MODERATOR ? 'auto' : input.moderatorId;
    return `${input.reason ?? '—'} (by ${by})`.slice(0, 512);
  }

  private async locale(guildId: string): Promise<Locale> {
    const guild = await this.services.db.guild.findUnique({ where: { id: guildId }, select: { locale: true } });
    return this.services.i18n.resolveLocale(guild?.locale);
  }
}
