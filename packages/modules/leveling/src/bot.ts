import type { BotModuleContext } from '@bot/core';
import { assignableRoleIds, changeMemberRoles, memberTemplateVars } from '@bot/discord';
import { renderMessage } from '@bot/templates';
import type { GuildMember, Message } from 'discord.js';
import type { LevelingConfig } from './config.js';
import { LevelingService, messageXp, rewardChanges } from './service.js';

type Ctx = BotModuleContext<LevelingConfig>;

const cooldownKey = (guildId: string, userId: string) => `leveling:cd:${guildId}:${userId}`;

/** Level reward roles: grants reached ones and removes the rest (when rewards don't stack). */
export async function syncRewards(member: GuildMember, level: number, config: LevelingConfig, logger: Ctx['logger']): Promise<void> {
  if (config.rewards.length === 0) return;
  const { add, remove } = rewardChanges(level, config);
  const toAdd = assignableRoleIds(member.guild, add).filter((id) => !member.roles.cache.has(id));
  const toRemove = assignableRoleIds(member.guild, remove).filter((id) => member.roles.cache.has(id));
  try {
    await changeMemberRoles(member, { add: toAdd, remove: toRemove }, 'Leveling: level reward');
  } catch (err) {
    logger.warn({ err, guildId: member.guild.id, userId: member.id }, 'Level rewards not applied');
  }
}

async function announce(ctx: Ctx, message: Message<true>, member: GuildMember, level: number, xp: number, config: LevelingConfig) {
  const { mode, channelId } = config.announcement;
  if (mode === 'off') return;
  const rendered = renderMessage(config.announcement.message, { ...memberTemplateVars(member), level, xp });

  try {
    if (mode === 'dm') {
      await member.send(rendered);
      return;
    }
    const channel =
      mode === 'current' ? message.channel : (channelId && (await message.guild.channels.fetch(channelId).catch(() => null))) || null;
    if (channel?.isSendable()) await channel.send(rendered);
  } catch (err) {
    ctx.logger.debug({ err, guildId: message.guildId }, 'Level-up announcement not delivered');
  }
}

/** XP per message: cooldown in Redis (shared by clusters), atomic increment in the database. */
export async function onMessage(ctx: Ctx, message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || message.system) return;
  const member = message.member;
  if (!member) return;

  const config = await ctx.getConfig(message.guildId);
  const roleIds = [...member.roles.cache.keys()];
  if (config.ignoredChannelIds.includes(message.channelId) || roleIds.some((id) => config.ignoredRoleIds.includes(id))) return;

  if (config.cooldownSec > 0) {
    const fresh = await ctx.redis.set(cooldownKey(message.guildId, message.author.id), '1', 'EX', config.cooldownSec, 'NX');
    if (!fresh) return;
  }

  const amount = messageXp(config, { roleIds, channelId: message.channelId });
  if (amount <= 0) return;

  const change = await new LevelingService(ctx.db).addXp(
    message.guildId,
    message.author.id,
    amount,
    { username: message.author.username, avatar: message.author.avatar },
    { countMessage: true },
  );
  if (!change.leveledUp) return;

  await announce(ctx, message, member, change.row.level, change.row.xp, config);
  await syncRewards(member, change.row.level, config, ctx.logger);
}
