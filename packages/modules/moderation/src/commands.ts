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
  o.setName('user').setNameLocalizations({ ru: 'участник' }).setDescription('Member').setDescriptionLocalizations({ ru: 'Участник' }).setRequired(true);
const reasonOption = (o: SlashCommandStringOption) =>
  o.setName('reason').setNameLocalizations({ ru: 'причина' }).setDescription('Reason').setDescriptionLocalizations({ ru: 'Причина' }).setMaxLength(500);
const durationOption = (o: SlashCommandStringOption, required: boolean) =>
  o
    .setName('duration')
    .setNameLocalizations({ ru: 'срок' })
    .setDescription('Duration: 10m, 2h, 7d…')
    .setDescriptionLocalizations({ ru: 'Срок: 10м, 2ч, 7д…' })
    .setRequired(required);

function base(name: string, description: string, ru: string, permission: bigint) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDescriptionLocalizations({ ru })
    .setDefaultMemberPermissions(permission)
    .setContexts(InteractionContextType.Guild);
}

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

/** Общие проверки и разбор опций для команд наказаний. Возвращает `null`, если уже ответили ошибкой. */
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
    content: ctx.t(`moderation.done.${action}`, { user: user.username, number }),
    allowedMentions: { parse: [] },
  });
}

export const ban = defineCommand<ModerationConfig>({
  data: base('ban', 'Ban a member', 'Забанить участника', PermissionFlagsBits.BanMembers)
    .addUserOption(userOption)
    .addStringOption((o) => durationOption(o, false))
    .addStringOption(reasonOption)
    .addIntegerOption((o) =>
      o
        .setName('delete_days')
        .setNameLocalizations({ ru: 'удалить_дней' })
        .setDescription('Delete messages from the last N days')
        .setDescriptionLocalizations({ ru: 'Удалить сообщения за последние N дней' })
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
  data: base('unban', 'Unban a user', 'Разбанить пользователя', PermissionFlagsBits.BanMembers)
    .addUserOption((o) => userOption(o).setDescription('User ID or mention').setDescriptionLocalizations({ ru: 'ID или упоминание' }))
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
  data: base('kick', 'Kick a member', 'Выгнать участника', PermissionFlagsBits.KickMembers).addUserOption(userOption).addStringOption(reasonOption),
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
  data: base('mute', 'Time out a member', 'Замутить участника (тайм-аут)', PermissionFlagsBits.ModerateMembers)
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
  data: base('unmute', 'Remove a time out', 'Снять тайм-аут', PermissionFlagsBits.ModerateMembers).addUserOption(userOption).addStringOption(reasonOption),
  async execute(interaction, ctx) {
    const prepared = await prepare(interaction, ctx, null);
    if (!prepared) return;
    await interaction.deferReply();
    const modCase = await prepared.service.unmute(prepared.input, prepared.config);
    await done(interaction, ctx, 'unmute', modCase.number);
  },
});

export const warn = defineCommand<ModerationConfig>({
  data: base('warn', 'Warn a member', 'Выдать предупреждение', PermissionFlagsBits.ModerateMembers)
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
        content: ctx.t('moderation.done.escalated', { action: ctx.t(`moderation.actions.${escalated.type}`), number: escalated.number }),
        allowedMentions: { parse: [] },
      });
    }
  },
});

export const warns = defineCommand<ModerationConfig>({
  data: base('warns', 'Active warnings of a member', 'Активные предупреждения участника', PermissionFlagsBits.ModerateMembers).addUserOption(userOption),
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
  data: base('unwarn', 'Remove a warning', 'Снять предупреждение', PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((o) =>
      o.setName('case').setNameLocalizations({ ru: 'кейс' }).setDescription('Warning case number').setDescriptionLocalizations({ ru: 'Номер кейса' }).setRequired(true).setMinValue(1),
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
  data: base('case', 'Show a moderation case', 'Показать кейс модерации', PermissionFlagsBits.ModerateMembers).addIntegerOption((o) =>
    o.setName('number').setNameLocalizations({ ru: 'номер' }).setDescription('Case number').setDescriptionLocalizations({ ru: 'Номер кейса' }).setRequired(true).setMinValue(1),
  ),
  async execute(interaction, ctx) {
    const number = interaction.options.getInteger('number', true);
    const modCase = await ctx.db.modCase.findUnique({ where: { guildId_number: { guildId: interaction.guildId!, number } } });
    if (!modCase) {
      await interaction.reply(ephemeral(ctx.t('moderation.errors.caseNotFound')));
      return;
    }
    await interaction.reply({ embeds: [await new ModerationService(ctx).caseEmbed(modCase)], flags: MessageFlags.Ephemeral });
  },
});

export const clear = defineCommand<ModerationConfig>({
  data: base('clear', 'Delete recent messages', 'Удалить последние сообщения', PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('amount').setNameLocalizations({ ru: 'количество' }).setDescription('How many').setDescriptionLocalizations({ ru: 'Сколько' }).setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((o) => o.setName('user').setNameLocalizations({ ru: 'участник' }).setDescription('Only from this member').setDescriptionLocalizations({ ru: 'Только этого участника' })),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    const channel = interaction.channel;
    if (!channel || channel.isDMBased() || !('bulkDelete' in channel)) return;
    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const fetched = await channel.messages.fetch({ limit: 100 });
    const targets = [...fetched.values()].filter((m) => !user || m.author.id === user.id).slice(0, amount);
    // Discord удаляет пачкой только сообщения моложе 14 дней.
    const deleted = await channel.bulkDelete(targets, true);
    await interaction.editReply(ctx.t('moderation.done.clear', { count: deleted.size }));
  },
});

export const commands = [ban, unban, kick, mute, unmute, warn, warns, unwarn, caseCommand, clear];
