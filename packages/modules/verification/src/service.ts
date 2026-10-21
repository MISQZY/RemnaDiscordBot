import type { CoreServices } from '@bot/core';
import { guildVars, renderMessage, toRestMessage } from '@bot/templates';
import { ButtonStyle, ComponentType, DiscordAPIError, RESTJSONErrorCodes, Routes, type APIGuild } from 'discord.js';
import type { VerificationConfig } from './config.js';

/** customId prefix of the module's buttons: `vf:start`, `vf:pick:<option>`. */
export const PREFIX = 'vf';
export const kickKey = (guildId: string, userId: string) => `verification:kick:${guildId}:${userId}`;

type Services = Pick<CoreServices, 'db' | 'rest' | 'scheduler' | 'logger'>;

const ignore = (...codes: number[]) => (err: unknown) => {
  if (!(err instanceof DiscordAPIError && codes.includes(err.code as number))) throw err;
};

/** Lets the member in: the role, the unverified role taken away, the pending kick cancelled. Works via REST. */
export async function verifyMember(services: Services, guildId: string, userId: string, config: VerificationConfig, reason: string): Promise<void> {
  const { rest, scheduler } = services;
  if (config.roleId) await rest.put(Routes.guildMemberRole(guildId, userId, config.roleId), { reason });
  if (config.unverifiedRoleId) {
    await rest.delete(Routes.guildMemberRole(guildId, userId, config.unverifiedRoleId), { reason }).catch(ignore(RESTJSONErrorCodes.UnknownRole));
  }
  await scheduler.cancel(kickKey(guildId, userId));
}

/** Whether the member has passed already: has the role, or lacks the unverified one when only that is set. */
export function isVerified(roleIds: ReadonlySet<string>, config: Pick<VerificationConfig, 'roleId' | 'unverifiedRoleId'>): boolean {
  if (config.roleId) return roleIds.has(config.roleId);
  if (config.unverifiedRoleId) return !roleIds.has(config.unverifiedRoleId);
  return false;
}

/** Posts the verification message to the panel channel, or edits the one posted there before. */
export async function publishPanel(services: Services, guildId: string, config: VerificationConfig): Promise<{ channelId: string; messageId: string }> {
  const { rest, db } = services;
  const channelId = config.panel.channelId;
  if (!channelId) throw new Error('No verification channel');
  const guild = (await rest.get(Routes.guild(guildId), { query: new URLSearchParams({ with_counts: 'true' }) })) as APIGuild & { approximate_member_count?: number };
  const vars = guildVars({ id: guild.id, name: guild.name, memberCount: guild.approximate_member_count ?? 0 });
  const body = {
    ...toRestMessage(renderMessage(config.panel.message, vars)),
    components: [
      { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Success, label: config.panel.buttonLabel, custom_id: `${PREFIX}:start` }] },
    ],
  };

  const existing = await db.verificationPanel.findUnique({ where: { guildId } });
  let messageId: string | null = null;
  if (existing && existing.channelId === channelId) {
    try {
      await rest.patch(Routes.channelMessage(channelId, existing.messageId), { body });
      messageId = existing.messageId;
    } catch (err) {
      ignore(RESTJSONErrorCodes.UnknownMessage)(err);
    }
  } else if (existing) {
    await rest.delete(Routes.channelMessage(existing.channelId, existing.messageId)).catch(() => undefined);
  }
  messageId ??= ((await rest.post(Routes.channelMessages(channelId), { body })) as { id: string }).id;
  await db.verificationPanel.upsert({ where: { guildId }, create: { guildId, channelId, messageId }, update: { channelId, messageId } });
  return { channelId, messageId };
}

/** The emojis of the captcha: distinct and easy to tell apart. */
export const CAPTCHA_EMOJIS = ['🍎', '🍌', '🍇', '🍒', '🍋', '🥝', '🍉', '🥕', '🌽', '🍄', '🐟', '🌵'] as const;

/** Five options in random order and the one to press. */
export function makeChallenge(random: () => number = Math.random): { options: string[]; answer: number } {
  const pool = [...CAPTCHA_EMOJIS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const options = pool.slice(0, 5);
  return { options, answer: Math.floor(random() * options.length) };
}
