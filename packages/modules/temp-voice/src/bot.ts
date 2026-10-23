import { defineComponent, type BotModuleContext, type InteractionContext } from '@bot/core';
import { renderText } from '@bot/templates';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type Client,
  type GuildMember,
  type VoiceBasedChannel,
  type VoiceState,
} from 'discord.js';
import type { Action, Creator, TempVoiceConfig } from './config.js';

type Ctx = BotModuleContext<TempVoiceConfig>;
type Reply = { key: string; vars?: Record<string, string | number> };

/** customId prefix: `tv:<action>:<channelId>`. */
export const PREFIX = 'tv';
/** The owner runs the channel, but moves nobody: disconnecting goes through the bot's kick, which spares moderators. */
const OWNER_ALLOW = { ManageChannels: true, Connect: true, Speak: true, ViewChannel: true } as const;

/** Permissions of someone a channel owner may not kick out. */
const MODERATOR = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.MoveMembers;

/**
 * People in the voice channel, by voice states: `channel.members` resolves them through the member cache, which keeps
 * only some members of a big server, and would call a channel with people in it empty.
 */
export function occupants(channel: Pick<VoiceBasedChannel, 'id' | 'guild'>): number {
  return channel.guild.voiceStates.cache.filter((state) => state.channelId === channel.id).size;
}

export function channelName(creator: Pick<Creator, 'nameTemplate'>, member: { displayName: string; username: string }, count: number): string {
  return renderText(creator.nameTemplate, { 'user.displayName': member.displayName, 'user.name': member.username, count }).slice(0, 100) || member.displayName;
}

async function createFor(ctx: Ctx, member: GuildMember, creator: Creator, config: TempVoiceConfig): Promise<void> {
  // One new channel per member every few seconds: hopping in and out does not make a pile of them.
  if (!(await ctx.redis.set(`temp-voice:cooldown:${member.guild.id}:${member.id}`, '1', 'EX', 10, 'NX'))) return;
  const lobby = member.guild.channels.cache.get(creator.channelId);
  const count = (await ctx.db.tempVoiceChannel.count({ where: { guildId: member.guild.id, creatorId: creator.channelId } })) + 1;
  const channel = await member.guild.channels.create({
    name: channelName(creator, { displayName: member.displayName, username: member.user.username }, count),
    type: ChannelType.GuildVoice,
    parent: creator.categoryId ?? lobby?.parentId ?? null,
    userLimit: creator.userLimit,
    reason: `Temp voice for ${member.user.username}`,
  });
  await ctx.db.tempVoiceChannel.create({ data: { channelId: channel.id, guildId: member.guild.id, ownerId: member.id, creatorId: creator.channelId } });
  await channel.permissionOverwrites.edit(member.id, OWNER_ALLOW).catch(() => undefined);
  await member.voice.setChannel(channel).catch(async () => {
    // Left before being moved: nobody needs the channel.
    await removeChannel(ctx, channel);
  });
  if (config.controlPanel) await postPanel(ctx, channel, member).catch((err: unknown) => ctx.logger.warn({ err, channelId: channel.id }, 'Temp voice panel not posted'));
}

async function removeChannel(ctx: Ctx, channel: VoiceBasedChannel): Promise<void> {
  await ctx.db.tempVoiceChannel.deleteMany({ where: { channelId: channel.id } });
  await channel.delete('Temp voice channel is empty').catch(() => undefined);
}

async function postPanel(ctx: Ctx, channel: VoiceBasedChannel, owner: GuildMember): Promise<void> {
  const locale = await ctx.guildLocales.get(channel.guild.id);
  const t = (key: string, vars?: Record<string, string | number>) => ctx.i18n.t(locale, `temp-voice.${key}`, vars);
  const button = (action: Action, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`${PREFIX}:${action}:${channel.id}`).setLabel(t(`actions.${action}`)).setStyle(style);
  await channel.send({
    content: t('panel', { user: `<@${owner.id}>` }),
    allowedMentions: { users: [owner.id] },
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(button('lock'), button('unlock'), button('hide'), button('unhide')),
      new ActionRowBuilder<ButtonBuilder>().addComponents(button('limit'), button('rename'), button('claim', ButtonStyle.Primary)),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${PREFIX}:kick:${channel.id}`).setPlaceholder(t('actions.kick'))),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${PREFIX}:transfer:${channel.id}`).setPlaceholder(t('actions.transfer'))),
    ],
  });
}

/** Leaving a temp channel empty deletes it — housekeeping: the module's channels go while it is off too. */
export async function onVoiceLeave(ctx: Ctx, oldState: VoiceState, newState: VoiceState): Promise<void> {
  if (oldState.channelId === newState.channelId || !oldState.channel || occupants(oldState.channel) > 0) return;
  const temp = await ctx.db.tempVoiceChannel.findUnique({ where: { channelId: oldState.channel.id } });
  if (temp) await removeChannel(ctx, oldState.channel);
}

/** Joining a creator makes a channel. */
export async function onVoiceState(ctx: Ctx, oldState: VoiceState, newState: VoiceState): Promise<void> {
  if (oldState.channelId === newState.channelId) return;
  const config = await ctx.getConfig(newState.guild.id);
  const creator = config.creators.find((c) => c.channelId === newState.channelId);
  if (creator && newState.member && !newState.member.user.bot) await createFor(ctx, newState.member, creator, config);
}

/** After a restart: temp channels everyone left meanwhile are deleted, rows of deleted channels dropped. */
export async function onReady(ctx: Ctx, client: Client<true>): Promise<void> {
  const rows = await ctx.db.tempVoiceChannel.findMany({ where: { guildId: { in: [...client.guilds.cache.keys()] } } });
  for (const row of rows) {
    const channel = client.guilds.cache.get(row.guildId)?.channels.cache.get(row.channelId);
    if (!channel?.isVoiceBased()) await ctx.db.tempVoiceChannel.deleteMany({ where: { channelId: row.channelId } });
    else if (occupants(channel) === 0) await removeChannel(ctx, channel);
  }
}

/** Changes the temp channel; returns what to tell the member who did it. */
export async function applyAction(
  ctx: Pick<Ctx, 'db'>,
  member: GuildMember,
  channel: VoiceBasedChannel,
  action: Action,
  value?: string,
): Promise<Reply> {
  const row = await ctx.db.tempVoiceChannel.findUnique({ where: { channelId: channel.id } });
  if (!row) return { key: 'notTemp' };
  const isOwner = row.ownerId === member.id || member.permissions.has(PermissionFlagsBits.ManageChannels);

  if (action === 'claim') {
    if (row.ownerId === member.id) return { key: 'alreadyOwner' };
    if (channel.members.has(row.ownerId)) return { key: 'ownerHere' };
    if (!channel.members.has(member.id)) return { key: 'joinFirst' };
    await ctx.db.tempVoiceChannel.update({ where: { channelId: channel.id }, data: { ownerId: member.id } });
    await channel.permissionOverwrites.delete(row.ownerId).catch(() => undefined);
    await channel.permissionOverwrites.edit(member.id, OWNER_ALLOW);
    return { key: 'claimed' };
  }
  if (!isOwner) return { key: 'notOwner' };
  const everyone = channel.guild.roles.everyone;

  switch (action) {
    case 'lock':
      await channel.permissionOverwrites.edit(everyone, { Connect: false });
      return { key: 'locked' };
    case 'unlock':
      await channel.permissionOverwrites.edit(everyone, { Connect: null });
      return { key: 'unlocked' };
    case 'hide':
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: false });
      return { key: 'hidden' };
    case 'unhide':
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: null });
      return { key: 'shown' };
    case 'limit': {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) return { key: 'badLimit' };
      await channel.setUserLimit(limit);
      return { key: 'limitSet', vars: { limit: limit || '∞' } };
    }
    case 'rename': {
      const name = value?.trim().slice(0, 100);
      if (!name) return { key: 'badName' };
      await channel.setName(name);
      return { key: 'renamed', vars: { name } };
    }
    case 'kick': {
      if (!value || value === row.ownerId) return { key: 'badTarget' };
      const target = await channel.guild.members.fetch(value).catch(() => null);
      if (target?.permissions.any(MODERATOR)) return { key: 'badTarget' };
      await channel.permissionOverwrites.edit(value, { Connect: false });
      if (target?.voice.channelId === channel.id) await target.voice.disconnect().catch(() => undefined);
      return { key: 'kicked', vars: { user: `<@${value}>` } };
    }
    case 'transfer': {
      if (!value || value === row.ownerId || !channel.members.has(value)) return { key: 'badTarget' };
      await ctx.db.tempVoiceChannel.update({ where: { channelId: channel.id }, data: { ownerId: value } });
      await channel.permissionOverwrites.delete(row.ownerId).catch(() => undefined);
      await channel.permissionOverwrites.edit(value, OWNER_ALLOW);
      return { key: 'transferred', vars: { user: `<@${value}>` } };
    }
  }
}

const modal = (ctx: InteractionContext<TempVoiceConfig>, action: 'limit' | 'rename', channelId: string) =>
  new ModalBuilder()
    .setCustomId(`${PREFIX}:${action}:${channelId}`)
    .setTitle(ctx.t(`temp-voice.actions.${action}`).slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('value')
          .setLabel(ctx.t(action === 'limit' ? 'temp-voice.limitLabel' : 'temp-voice.nameLabel'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(action === 'limit' ? 2 : 100)
          .setRequired(true),
      ),
    );

/** Buttons, menus and forms of the control panel. */
export const tempVoiceComponent = defineComponent<TempVoiceConfig>({
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const [, action, channelId] = interaction.customId.split(':') as [string, Action, string];
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) return void (await interaction.reply({ content: ctx.t('temp-voice.notTemp'), flags: MessageFlags.Ephemeral }));

    if (interaction.isButton() && (action === 'limit' || action === 'rename')) return void (await interaction.showModal(modal(ctx, action, channelId)));
    const value = interaction.isModalSubmit()
      ? interaction.fields.getTextInputValue('value')
      : interaction.isUserSelectMenu()
        ? interaction.values[0]
        : undefined;
    const reply = await applyAction(ctx, interaction.member, channel, action, value);
    await interaction.reply({ content: ctx.t(`temp-voice.replies.${reply.key}`, reply.vars), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
});
