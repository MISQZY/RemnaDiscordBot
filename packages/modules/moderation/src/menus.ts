import { defineComponent, defineContextMenu, type InteractionContext } from '@bot/core';
import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';
import { hierarchyError } from './checks.js';
import type { ModerationConfig } from './config.js';
import { parseDuration } from './duration.js';
import { historyLines } from './history.js';
import { ModerationService } from './service.js';

type Ctx = InteractionContext<ModerationConfig>;

/** customId prefix of the module's modals and buttons: `mod:<action>:…`. */
export const MOD_PREFIX = 'mod';

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const, allowedMentions: { parse: [] } });

const menu = (name: string, type: ApplicationCommandType.User | ApplicationCommandType.Message, permission: bigint | null) =>
  new ContextMenuCommandBuilder().setName(name).setType(type).setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(permission);

const reasonInput = (ctx: Ctx, required: boolean) =>
  new TextInputBuilder()
    .setCustomId('reason')
    .setLabel(ctx.t('moderation.menus.reason'))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(required);

const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);

export const warnMenu = defineContextMenu<ModerationConfig>({
  key: 'warn',
  data: menu('Warn', ApplicationCommandType.User, PermissionFlagsBits.ModerateMembers),
  async execute(interaction, ctx) {
    if (!interaction.isUserContextMenuCommand()) return;
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${MOD_PREFIX}:warn:${interaction.targetId}`)
        .setTitle(ctx.t('moderation.menus.warnTitle', { user: interaction.targetUser.username }).slice(0, 45))
        .addComponents(row(reasonInput(ctx, true))),
    );
  },
});

export const muteMenu = defineContextMenu<ModerationConfig>({
  key: 'mute',
  data: menu('Mute', ApplicationCommandType.User, PermissionFlagsBits.ModerateMembers),
  async execute(interaction, ctx) {
    if (!interaction.isUserContextMenuCommand()) return;
    const config = await ctx.getConfig(interaction.guildId!);
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${MOD_PREFIX}:mute:${interaction.targetId}`)
        .setTitle(ctx.t('moderation.menus.muteTitle', { user: interaction.targetUser.username }).slice(0, 45))
        .addComponents(
          row(new TextInputBuilder().setCustomId('duration').setLabel(ctx.t('moderation.menus.duration')).setPlaceholder('10m, 2h, 1d').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true)),
          row(reasonInput(ctx, config.requireReason)),
        ),
    );
  },
});

export const historyMenu = defineContextMenu<ModerationConfig>({
  key: 'history',
  data: menu('Moderation history', ApplicationCommandType.User, PermissionFlagsBits.ModerateMembers),
  async execute(interaction, ctx) {
    if (!interaction.isUserContextMenuCommand()) return;
    const cases = await new ModerationService(ctx).history(interaction.guildId!, interaction.targetId);
    await interaction.reply(ephemeral(historyLines(ctx, interaction.targetUser.username, cases)));
  },
});

export const reportMenu = defineContextMenu<ModerationConfig>({
  key: 'report',
  data: menu('Report message', ApplicationCommandType.Message, null),
  cooldownMs: 30_000,
  async execute(interaction, ctx) {
    if (!interaction.isMessageContextMenuCommand()) return;
    const config = await ctx.getConfig(interaction.guildId!);
    if (!config.reportChannelId) return void (await interaction.reply(ephemeral(ctx.t('moderation.report.off'))));
    if (interaction.targetMessage.author.id === interaction.user.id) return void (await interaction.reply(ephemeral(ctx.t('moderation.report.own'))));
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${MOD_PREFIX}:report:${interaction.channelId}:${interaction.targetId}`)
        .setTitle(ctx.t('moderation.report.title').slice(0, 45))
        .addComponents(row(reasonInput(ctx, true))),
    );
  },
});

export const contextMenus = [warnMenu, muteMenu, historyMenu, reportMenu];

async function targetMember(interaction: ModalSubmitInteraction, userId: string): Promise<GuildMember | null> {
  return interaction.guild?.members.fetch(userId).catch(() => null) ?? null;
}

async function submitPunishment(interaction: ModalSubmitInteraction, ctx: Ctx, action: 'warn' | 'mute', userId: string): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const permission = PermissionFlagsBits.ModerateMembers;
  if (!interaction.memberPermissions.has(permission)) return void (await interaction.reply(ephemeral(ctx.t('moderation.errors.noPermission'))));

  const target = await targetMember(interaction, userId);
  if (!target) return void (await interaction.reply(ephemeral(ctx.t('moderation.errors.notMember'))));
  const error = hierarchyError(interaction.member, target, action);
  if (error) return void (await interaction.reply(ephemeral(ctx.t(error))));

  const config = await ctx.getConfig(interaction.guildId);
  const reason = interaction.fields.getTextInputValue('reason').trim() || null;
  if (config.requireReason && !reason) return void (await interaction.reply(ephemeral(ctx.t('moderation.errors.reasonRequired'))));

  const service = new ModerationService(ctx);
  const input = { guildId: interaction.guildId, targetId: userId, moderatorId: interaction.user.id, reason };
  if (action === 'mute') {
    const durationSec = parseDuration(interaction.fields.getTextInputValue('duration'));
    if (!durationSec) return void (await interaction.reply(ephemeral(ctx.t('moderation.errors.invalidDuration'))));
    await interaction.deferReply();
    const modCase = await service.mute({ ...input, durationSec }, config);
    await interaction.editReply({ content: ctx.tGuild('moderation.done.mute', { user: target.user.username, number: modCase.number }), allowedMentions: { parse: [] } });
    return;
  }

  await interaction.deferReply();
  const { case: modCase, escalated } = await service.warn(input, config);
  await interaction.editReply({ content: ctx.tGuild('moderation.done.warn', { user: target.user.username, number: modCase.number }), allowedMentions: { parse: [] } });
  if (escalated) {
    await interaction.followUp({
      content: ctx.tGuild('moderation.done.escalated', { action: ctx.tGuild(`moderation.actions.${escalated.type}`), number: escalated.number }),
      allowedMentions: { parse: [] },
    });
  }
}

/** The report goes to the reports channel with the message quoted and buttons for the moderators. */
async function submitReport(interaction: ModalSubmitInteraction, ctx: Ctx, channelId: string, messageId: string): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const config = await ctx.getConfig(interaction.guildId);
  const reportChannel = config.reportChannelId ? interaction.guild.channels.cache.get(config.reportChannelId) : undefined;
  if (!reportChannel?.isSendable()) return void (await interaction.reply(ephemeral(ctx.t('moderation.report.off'))));

  const source = interaction.guild.channels.cache.get(channelId);
  const message = source?.isTextBased() ? await source.messages.fetch(messageId).catch(() => null) : null;
  if (!message) return void (await interaction.reply(ephemeral(ctx.t('moderation.report.gone'))));

  const embed: APIEmbed = {
    title: ctx.tGuild('moderation.report.embedTitle'),
    url: message.url,
    color: 0xf0a020,
    description: message.content.slice(0, 2000) || `*${ctx.tGuild('moderation.report.noText')}*`,
    fields: [
      { name: ctx.tGuild('moderation.report.author'), value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
      { name: ctx.tGuild('moderation.report.channel'), value: `<#${channelId}>`, inline: true },
      { name: ctx.tGuild('moderation.report.by'), value: `<@${interaction.user.id}>`, inline: true },
      { name: ctx.tGuild('moderation.report.reason'), value: interaction.fields.getTextInputValue('reason').slice(0, 1024) },
    ],
    timestamp: new Date().toISOString(),
  };
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${MOD_PREFIX}:rdel:${channelId}:${messageId}`).setStyle(ButtonStyle.Danger).setLabel(ctx.tGuild('moderation.report.delete')),
    new ButtonBuilder().setCustomId(`${MOD_PREFIX}:rdone`).setStyle(ButtonStyle.Secondary).setLabel(ctx.tGuild('moderation.report.done')),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(message.url).setLabel(ctx.tGuild('moderation.report.open')),
  );
  await reportChannel.send({
    content: config.reportRoleId ? `<@&${config.reportRoleId}>` : undefined,
    embeds: [embed],
    components: [buttons],
    allowedMentions: { roles: config.reportRoleId ? [config.reportRoleId] : [] },
  });
  await interaction.reply(ephemeral(ctx.t('moderation.report.sent')));
}

/** Modals of the menus and the buttons of reports. */
export const moderationComponent = defineComponent<ModerationConfig>({
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const [, action, a, b] = interaction.customId.split(':');

    if (interaction.isModalSubmit()) {
      if ((action === 'warn' || action === 'mute') && a) return submitPunishment(interaction, ctx, action, a);
      if (action === 'report' && a && b) return submitReport(interaction, ctx, a, b);
      return;
    }
    if (!interaction.isButton()) return;

    const handled = `${ctx.tGuild('moderation.report.handledBy', { user: interaction.user.username })}`;
    const close = async (note: string) => {
      const [embed] = interaction.message.embeds;
      await interaction.update({
        embeds: embed ? [{ ...embed.toJSON(), color: 0x3ba55d, footer: { text: note } }] : [],
        components: [],
      });
    };

    if (action === 'rdel' && a && b) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) return void (await interaction.reply(ephemeral(ctx.t('moderation.errors.noPermission'))));
      const channel = interaction.guild.channels.cache.get(a);
      if (channel?.isTextBased()) await channel.messages.delete(b).catch(() => undefined);
      await close(`${handled} · ${ctx.tGuild('moderation.report.deleted')}`);
      return;
    }
    if (action === 'rdone') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) return void (await interaction.reply(ephemeral(ctx.t('moderation.errors.noPermission'))));
      await close(handled);
    }
  },
});
