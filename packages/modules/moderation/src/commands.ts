import { defineCommand, type InteractionContext } from '@bot/core';
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type SlashCommandUserOption,
  type SlashCommandStringOption,
} from 'discord.js';
import { hierarchyError, type PunishAction } from './checks.js';
import { type ModerationConfig } from './config.js';
import { parseDuration } from './duration.js';
import { ModerationService } from './service.js';

type Ctx = InteractionContext<ModerationConfig>;

const userOption = (o: SlashCommandUserOption) =>
  o.setName('user').setDescription('Member').setRequired(true);
const reasonOption = (o: SlashCommandStringOption) =>
  o.setName('reason').setDescription('Reason').setMaxLength(500);
const durationOption = (o: SlashCommandStringOption, required: boolean) =>
  o
    .setName('duration')
    .setDescription('Duration: 10m, 2h, 7d…')
    .setRequired(required);

function base(name: string, description: string, permission: bigint) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(permission)
    .setContexts(InteractionContextType.Guild);
}

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

/** Common checks and option parsing for punishment commands. Returns `null` when an error reply was already sent. */
async function prepare(
  interaction: ChatInputCommandInteraction,
  ctx: Ctx,
  action: PunishAction | null,
  { durationRequired = false } = {},
) {
  const config = await ctx.getConfig(interaction.guildId!);
  const reason = interaction.options.getString('reason');
  if (config.requireReason && !reason && action) {
    await interaction.reply(ephemeral(ctx.t('moderation.errors.reasonRequired')));
    return null;
  }

  const rawDuration = interaction.options.getString('duration');
  const durationSec = rawDuration ? parseDuration(rawDuration) : null;
  if ((rawDuration && durationSec === null) || (durationRequired && !durationSec)) {
    await interaction.reply(ephemeral(ctx.t('moderation.errors.invalidDuration')));
    return null;
  }

  const target = interaction.options.getMember('user') as GuildMember | null;
  if (action && target) {
    const error = hierarchyError(interaction.member as GuildMember, target, action);
    if (error) {
      await interaction.reply(ephemeral(ctx.t(error)));
      return null;
    }
  }

  return {
    config,
    service: new ModerationService(ctx),
    input: {
      guildId: interaction.guildId!,
      targetId: interaction.options.getUser('user', true).id,
      moderatorId: interaction.user.id,
      reason,
      durationSec,
    },
  };
}

async function done(interaction: ChatInputCommandInteraction, ctx: Ctx, action: string, number: number) {
  const user = interaction.options.getUser('user', true);
  await interaction.editReply({
    // Everyone sees the result — use the server's language.
    content: ctx.tGuild(`moderation.done.${action}`, { user: user.username, number }),
    allowedMentions: { parse: [] },
  });
}

export const ban = defineCommand<ModerationConfig>({
  data: base('ban', 'Ban a member', PermissionFlagsBits.BanMembers)
    .addUserOption(userOption)
    .addStringOption((o) => durationOption(o, false))
    .addStringOption(reasonOption)
    .addIntegerOption((o) =>
      o
        .setName('delete_days')
        .setDescription('Delete messages from the last N days')
        .setMinValue(0)
        .setMaxValue(7),
    ),
  async execute(interaction, ctx) {
    const prepared = await prepare(interaction, ctx, 'ban');
    if (!prepared) return;
    await interaction.deferReply();
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
    const modCase = await prepared.service.ban({ ...prepared.input, deleteMessageSeconds: deleteDays * 86_400 }, prepared.config);
    await done(interaction, ctx, 'ban', modCase.number);
  },
});

export const unban = defineCommand<ModerationConfig>({
  data: base('unban', 'Unban a user', PermissionFlagsBits.BanMembers)
    .addUserOption((o) => userOption(o).setDescription('User ID or mention'))
    .addStringOption(reasonOption),
  async execute(interaction, ctx) {
    const prepared = await prepare(interaction, ctx, null);
    if (!prepared) return;
    await interaction.deferReply();
    const modCase = await prepared.service.unban(prepared.input, prepared.config);
    await done(interaction, ctx, 'unban', modCase.number);
  },
});

export const kick = defineCommand<ModerationConfig>({
  data: base('kick', 'Kick a member', PermissionFlagsBits.KickMembers).addUserOption(userOption).addStringOption(reasonOption),
  async execute(interaction, ctx) {
    const prepared = await prepare(interaction, ctx, 'kick');
    if (!prepared) return;
    if (!interaction.options.getMember('user')) {
      await interaction.reply(ephemeral(ctx.t('moderation.errors.notMember')));
      return;
    }
    await interaction.deferReply();
    const modCase = await prepared.service.kick(prepared.input, prepared.config);
    await done(interaction, ctx, 'kick', modCase.number);
  },
});

export const mute = defineCommand<ModerationConfig>({
  data: base('mute', 'Time out a member', PermissionFlagsBits.ModerateMembers)
    .addUserOption(userOption)
    .addStringOption((o) => durationOption(o, true))
    .addStringOption(reasonOption),
  async execute(interaction, ctx) {
    const prepared = await prepare(interaction, ctx, 'mute', { durationRequired: true });
    if (!prepared) return;
    await interaction.deferReply();
    const modCase = await prepared.service.mute(prepared.input, prepared.config);
    await done(interaction, ctx, 'mute', modCase.number);
  },
});

export const unmute = defineCommand<ModerationConfig>({
  data: base('unmute', 'Remove a time out', PermissionFlagsBits.ModerateMembers).addUserOption(userOption).addStringOption(reasonOption),
  async execute(interaction, ctx) {
    const prepared = await prepare(interaction, ctx, null);
    if (!prepared) return;
    await interaction.deferReply();
    const modCase = await prepared.service.unmute(prepared.input, prepared.config);
    await done(interaction, ctx, 'unmute', modCase.number);
  },
});

export const warn = defineCommand<ModerationConfig>({
  data: base('warn', 'Warn a member', PermissionFlagsBits.ModerateMembers)
    .addUserOption(userOption)
    .addStringOption((o) => reasonOption(o).setRequired(true)),
  async execute(interaction, ctx) {
    const prepared = await prepare(interaction, ctx, 'warn');
    if (!prepared) return;
    await interaction.deferReply();
    const { case: modCase, escalated } = await prepared.service.warn(prepared.input, prepared.config);
    await done(interaction, ctx, 'warn', modCase.number);
    if (escalated) {
      await interaction.followUp({
        content: ctx.tGuild('moderation.done.escalated', { action: ctx.tGuild(`moderation.actions.${escalated.type}`), number: escalated.number }),
        allowedMentions: { parse: [] },
      });
    }
  },
});

export const warns = defineCommand<ModerationConfig>({
  data: base('warns', 'Active warnings of a member', PermissionFlagsBits.ModerateMembers).addUserOption(userOption),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser('user', true);
    const list = await new ModerationService(ctx).activeWarnings(interaction.guildId!, user.id);
    const lines = list.map(
      (w) => `**#${w.number}** · ${w.reason ?? ctx.t('moderation.case.noReason')} · <t:${Math.floor(w.createdAt.getTime() / 1000)}:R>`,
    );
    await interaction.reply({
      content: lines.length > 0 ? `${ctx.t('moderation.warnsTitle', { user: user.username, count: lines.length })}\n${lines.join('\n')}` : ctx.t('moderation.noWarns'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
});

export const unwarn = defineCommand<ModerationConfig>({
  data: base('unwarn', 'Remove a warning', PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((o) =>
      o.setName('case').setDescription('Warning case number').setRequired(true).setMinValue(1),
    )
    .addStringOption(reasonOption),
  async execute(interaction, ctx) {
    const number = interaction.options.getInteger('case', true);
    const existing = await ctx.db.modCase.findUnique({ where: { guildId_number: { guildId: interaction.guildId!, number } } });
    if (existing?.type !== 'warn') {
      await interaction.reply(ephemeral(ctx.t('moderation.errors.notWarning')));
      return;
    }
    const config = await ctx.getConfig(interaction.guildId!);
    await new ModerationService(ctx).revoke(interaction.guildId!, number, interaction.user.id, interaction.options.getString('reason'), config);
    await interaction.reply(ephemeral(ctx.t('moderation.done.unwarn', { number })));
  },
});

export const caseCommand = defineCommand<ModerationConfig>({
  data: base('case', 'Moderation cases', PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription('Show a moderation case')
        .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('reason')
        .setDescription('Change the reason of a case')
        .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true).setMaxLength(500)),
    ),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const number = interaction.options.getInteger('number', true);
    const service = new ModerationService(ctx);
    const modCase = await ctx.db.modCase.findUnique({ where: { guildId_number: { guildId, number } } });
    if (!modCase) {
      await interaction.reply(ephemeral(ctx.t('moderation.errors.caseNotFound')));
      return;
    }
    if (interaction.options.getSubcommand() === 'reason') {
      // Only the case author or a server manager rewrites someone's reason.
      if (modCase.moderatorId !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply(ephemeral(ctx.t('moderation.errors.notYourCase')));
        return;
      }
      const updated = await service.updateReason(guildId, number, interaction.options.getString('reason', true));
      await interaction.reply({ content: ctx.t('moderation.done.reason', { number }), embeds: [await service.caseEmbed(updated)], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [await service.caseEmbed(modCase)], flags: MessageFlags.Ephemeral });
  },
});

export const clear = defineCommand<ModerationConfig>({
  data: base('clear', 'Delete recent messages', PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((o) => o.setName('user').setDescription('Only from this member')),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    const channel = interaction.channel;
    if (!channel || channel.isDMBased() || !('bulkDelete' in channel)) return;
    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const fetched = await channel.messages.fetch({ limit: 100 });
    const targets = [...fetched.values()].filter((m) => !user || m.author.id === user.id).slice(0, amount);
    // Discord bulk-deletes only messages younger than 14 days.
    const deleted = await channel.bulkDelete(targets, true);
    await interaction.editReply(ctx.t('moderation.done.clear', { count: deleted.size }));
  },
});

export const commands = [ban, unban, kick, mute, unmute, warn, warns, unwarn, caseCommand, clear];
