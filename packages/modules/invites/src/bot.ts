import { eachLimit, type BotModuleContext } from '@bot/core';
import { assignableRoleIds, changeMemberRoles } from '@bot/discord';
import type { Client, Guild, GuildMember, Invite, PartialGuildMember } from 'discord.js';
import type { InvitesConfig } from './config.js';
import { countsOf, earnedRoles, readUses, saveUses, usedInvite, usesKey } from './service.js';

type Ctx = BotModuleContext<InvitesConfig>;

/** The server's invites with their uses; the vanity link counts as one too. Needs Manage Server. */
async function currentInvites(guild: Guild): Promise<{ code: string; uses: number; inviterId: string | null }[] | null> {
  const invites = await guild.invites.fetch({ cache: false }).catch(() => null);
  if (!invites) return null;
  const list = [...invites.values()].map((i) => ({ code: i.code, uses: i.uses ?? 0, inviterId: i.inviterId }));
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity) list.push({ code: 'vanity', uses: vanity.uses, inviterId: null });
  }
  return list;
}

export async function snapshot(ctx: Ctx, guild: Guild): Promise<void> {
  const invites = await currentInvites(guild);
  if (invites) await saveUses(ctx, guild.id, invites);
}

/** After a restart: the invite uses of every server with the module on, a few servers at a time (REST calls). */
export async function onReady(ctx: Ctx, client: Client<true>): Promise<void> {
  await eachLimit([...client.guilds.cache.values()], 5, async (guild) => {
    if (await ctx.config.isEnabled(guild.id, 'invites')) await snapshot(ctx, guild).catch((err: unknown) => ctx.logger.warn({ err, guildId: guild.id }, 'Invites not read'));
  });
}

export async function onInviteCreate(ctx: Ctx, invite: Invite): Promise<void> {
  if (invite.guild) await ctx.redis.hset(usesKey(invite.guild.id), invite.code, String(invite.uses ?? 0));
}

export async function onInviteDelete(ctx: Ctx, invite: Invite): Promise<void> {
  if (invite.guild) await ctx.redis.hdel(usesKey(invite.guild.id), invite.code);
}

async function log(ctx: Ctx, guild: Guild, config: InvitesConfig, text: string): Promise<void> {
  if (!config.logChannelId) return;
  const channel = guild.channels.cache.get(config.logChannelId);
  if (channel?.isSendable()) await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
}

export async function onMemberJoin(ctx: Ctx, member: GuildMember): Promise<void> {
  const guild = member.guild;
  const config = await ctx.getConfig(guild.id);
  const before = await readUses(ctx, guild.id);
  const after = await currentInvites(guild);
  if (after) await saveUses(ctx, guild.id, after);
  const used = after ? usedInvite(before, after) : null;
  const inviterId = used?.inviterId ?? null;
  const fake = config.fakeAccountDays > 0 && Date.now() - member.user.createdTimestamp < config.fakeAccountDays * 86_400_000;

  await ctx.db.memberInvite.upsert({
    where: { guildId_userId: { guildId: guild.id, userId: member.id } },
    create: { guildId: guild.id, userId: member.id, inviterId, code: used?.code ?? null, fake },
    update: { inviterId, code: used?.code ?? null, fake, joinedAt: new Date(), leftAt: null },
  });

  const counts = inviterId ? await countsOf(ctx, guild.id, inviterId, config) : null;
  await ctx.bus.emit('invites.joined', { guildId: guild.id, userId: member.id, inviterId, code: used?.code ?? null, invites: counts?.total ?? 0 });

  const locale = await ctx.guildLocales.get(guild.id);
  const t = (key: string, vars: Record<string, string | number>) => ctx.i18n.t(locale, key, vars);
  await log(
    ctx,
    guild,
    config,
    inviterId
      ? t('invites.log.joined', { user: `<@${member.id}>`, inviter: `<@${inviterId}>`, code: used!.code, count: counts!.total })
      : t(used?.code === 'vanity' ? 'invites.log.vanity' : 'invites.log.unknown', { user: `<@${member.id}>` }),
  );

  if (inviterId && counts && config.rewards.length > 0) {
    const inviter = await guild.members.fetch(inviterId).catch(() => null);
    const roles = assignableRoleIds(guild, earnedRoles(config.rewards, counts.total)).filter((id) => !inviter?.roles.cache.has(id));
    if (inviter && roles.length > 0) await changeMemberRoles(inviter, { add: roles }, 'Invites: reward');
  }
}

export async function onMemberLeave(ctx: Ctx, member: GuildMember | PartialGuildMember): Promise<void> {
  await ctx.db.memberInvite.updateMany({ where: { guildId: member.guild.id, userId: member.id }, data: { leftAt: new Date() } });
}
