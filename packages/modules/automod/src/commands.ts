import { defineCommand } from '@bot/core';
import { channelMention, EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AutomodConfig, FILTERS, type FilterName } from './config.js';
import { endRaid, raidKey } from './raid.js';

export const automodCommand = defineCommand<AutomodConfig>({
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Automatic moderation: filters and raid protection')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('status').setDescription('Show filters and raid protection'))
    .addSubcommand((s) =>
      s
        .setName('filter')
        .setDescription('Turn a filter on or off')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Filter')
            .setRequired(true)
            .addChoices(...FILTERS.map((value) => ({ name: value, value }))),
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('On').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('raid-end').setDescription('End raid mode: unlock channels and resume invites')),
  cooldownMs: 2_000,
  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    const onOff = (value: boolean) => ctx.t(value ? 'automod.on' : 'automod.off');

    if (sub === 'status') {
      const config = await ctx.getConfig(guildId);
      const raidUntil = await ctx.redis.get(raidKey(guildId));
      const filters = FILTERS.map((name) => `${config.filters[name].enabled ? '🟢' : '⚪'} ${ctx.t(`automod.filters.${name}`)}`);
      const embed = new EmbedBuilder().setTitle(ctx.t('automod.name')).addFields(
        { name: ctx.t('automod.status.filters'), value: filters.join('\n') },
        {
          name: ctx.t('automod.status.raid'),
          value: config.raid.enabled ? ctx.t('automod.status.raidRule', { joins: config.raid.joins, seconds: config.raid.seconds }) : onOff(false),
          inline: true,
        },
        { name: ctx.t('automod.status.raidMode'), value: raidUntil ? `<t:${Math.floor(Number(raidUntil) / 1000)}:R>` : onOff(false), inline: true },
        {
          name: ctx.t('automod.status.accountAge'),
          value: config.accountAge.enabled ? ctx.t('automod.status.days', { days: config.accountAge.minDays }) : onOff(false),
          inline: true,
        },
        { name: ctx.t('automod.status.log'), value: config.logChannelId ? channelMention(config.logChannelId) : onOff(false), inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'filter') {
      const name = interaction.options.getString('name', true) as FilterName;
      const enabled = interaction.options.getBoolean('enabled', true);
      const config = structuredClone(await ctx.getConfig(guildId));
      config.filters[name].enabled = enabled;
      await ctx.config.update(guildId, ctx.moduleId, { config: AutomodConfig.parse(config) }, interaction.user.id);
      await interaction.reply({ content: ctx.t('automod.filterSet', { filter: ctx.t(`automod.filters.${name}`), state: onOff(enabled) }), flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ended = await endRaid(ctx, guildId);
    await interaction.editReply(ctx.t(ended ? 'automod.raid.ended' : 'automod.raid.notActive'));
  },
});
