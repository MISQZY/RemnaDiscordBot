import { defineCommand } from '@bot/core';
import {
  channelMention,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildBasedChannel,
} from 'discord.js';
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
    .addSubcommand((s) => s.setName('raid-end').setDescription('End raid mode: unlock channels and resume invites'))
    .addSubcommand((s) =>
      s
        .setName('honeypot')
        .setDescription('A channel where whoever writes is taken for a spam bot; empty — off')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('What to do with them')
            .addChoices({ name: 'Softban', value: 'softban' }, { name: 'Ban', value: 'ban' }, { name: 'Kick', value: 'kick' }, { name: 'Mute', value: 'mute' }),
        ),
    ),
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
        {
          name: ctx.t('automod.status.honeypot'),
          value: config.honeypot.channelId ? `${channelMention(config.honeypot.channelId)} · ${ctx.t(`automod.honeypot.actions.${config.honeypot.action}`)}` : onOff(false),
          inline: true,
        },
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

    if (sub === 'honeypot') {
      const channel = interaction.options.getChannel('channel') as GuildBasedChannel | null;
      const action = interaction.options.getString('action') as AutomodConfig['honeypot']['action'] | null;
      const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      if (channel) {
        const me = channel.guild.members.me;
        if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages])) {
          return void (await reply(ctx.t('automod.honeypot.access', { channel: channelMention(channel.id) })));
        }
      }
      const config = structuredClone(await ctx.getConfig(guildId));
      config.honeypot = { ...config.honeypot, channelId: channel?.id ?? null, ...(action ? { action } : {}) };
      await ctx.config.update(guildId, ctx.moduleId, { config: AutomodConfig.parse(config) }, interaction.user.id);
      await reply(
        channel
          ? ctx.t('automod.honeypot.set', { channel: channelMention(channel.id), action: ctx.t(`automod.honeypot.actions.${config.honeypot.action}`) })
          : ctx.t('automod.honeypot.off'),
      );
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ended = await endRaid(ctx, guildId);
    await interaction.editReply(ctx.t(ended ? 'automod.raid.ended' : 'automod.raid.notActive'));
  },
});
