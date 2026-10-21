import { memberTemplateVars } from '@bot/discord';
import type { Logger } from '@bot/logger';
import { renderMessage, type TemplateVars } from '@bot/templates';
import type { GuildMember, PartialGuildMember } from 'discord.js';
import type { WelcomeConfig, WelcomeKind } from './config.js';

export interface GreetOptions {
  /** Send even when the message is disabled in the config (a test send). */
  force?: boolean;
  /** Placeholders found elsewhere: the inviter of the invites module. */
  vars?: TemplateVars;
}

/** Sends the welcome, farewell or DM. Returns whether anything was sent. */
export async function greet(
  kind: WelcomeKind,
  member: GuildMember | PartialGuildMember,
  config: WelcomeConfig,
  logger: Logger,
  { force = false, vars = {} }: GreetOptions = {},
): Promise<boolean> {
  const settings = kind === 'join' ? config.join : kind === 'leave' ? config.leave : config.joinDm;
  if (!settings.enabled && !force) return false;

  const message = renderMessage(settings.message, { ...memberTemplateVars(member), ...vars });

  if (kind === 'dm') {
    try {
      await member.send(message);
      return true;
    } catch (err) {
      // The user's DMs are closed — not a module error.
      logger.debug({ err, userId: member.id }, 'Welcome DM not delivered');
      return false;
    }
  }

  const channelId = kind === 'join' ? config.join.channelId : config.leave.channelId;
  if (!channelId) return false;

  const channel = member.guild.channels.cache.get(channelId) ?? (await member.guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isSendable()) {
    logger.warn({ guildId: member.guild.id, channelId }, 'Welcome channel is missing or not writable');
    return false;
  }
  await channel.send(message);
  return true;
}
