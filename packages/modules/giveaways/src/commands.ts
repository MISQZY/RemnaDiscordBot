import { defineCommand } from '@bot/core';
import { parseDuration } from '@bot/templates';
import { ChannelType, InteractionContextType, MessageFlags, SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import { isManager } from './bot.js';
import { MAX_DURATION_SEC, type GiveawaysConfig } from './config.js';
import { GiveawayService } from './service.js';

const idOption = (s: SlashCommandSubcommandBuilder) => s.addStringOption((o) => o.setName('giveaway').setDescription('Giveaway').setRequired(true).setAutocomplete(true));

export const giveawayCommand = defineCommand<GiveawaysConfig>({
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaways')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a giveaway')
        .addStringOption((o) => o.setName('prize').setDescription('What is given away').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('duration').setDescription('How long: 1h, 2d…').setRequired(true).setMaxLength(20))
        .addIntegerOption((o) => o.setName('winners').setDescription('How many winners').setMinValue(1).setMaxValue(50))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel; the current one by default').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption((o) => o.setName('role').setDescription('Only members with this role'))
        .addIntegerOption((o) => o.setName('days').setDescription('Only members on the server this many days').setMinValue(0).setMaxValue(365))
        .addStringOption((o) => o.setName('description').setDescription('Details').setMaxLength(1000)),
    )
    .addSubcommand((s) => idOption(s.setName('end').setDescription('End a giveaway now')))
    .addSubcommand((s) =>
      idOption(s.setName('reroll').setDescription('Draw new winners of an ended giveaway')).addIntegerOption((o) =>
        o.setName('count').setDescription('How many').setMinValue(1).setMaxValue(50),
      ),
    )
    .addSubcommand((s) => idOption(s.setName('cancel').setDescription('Cancel a giveaway without winners'))),
  cooldownMs: 2_000,
  async autocomplete(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const rows = await ctx.db.giveaway.findMany({
      where: { guildId: interaction.guildId!, status: sub === 'reroll' ? 'ended' : 'running' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    await interaction.respond(rows.map((g) => ({ name: g.prize.slice(0, 100), value: g.id })));
  },
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const config = await ctx.getConfig(interaction.guildId);
    const reply = (key: string, vars?: Record<string, string | number>) =>
      interaction.reply({ content: ctx.t(key, vars), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (!isManager(interaction.member, config)) return void (await reply('giveaways.noAccess'));
    const service = new GiveawayService(ctx);
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const seconds = parseDuration(interaction.options.getString('duration', true));
      if (!seconds || seconds < 60 || seconds > MAX_DURATION_SEC) return void (await reply('giveaways.badDuration'));
      const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
      const role = interaction.options.getRole('role');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const giveaway = await service.start(
        interaction.guildId,
        {
          channelId,
          prize: interaction.options.getString('prize', true),
          description: interaction.options.getString('description'),
          winners: interaction.options.getInteger('winners') ?? 1,
          endsAt: new Date(Date.now() + seconds * 1000).toISOString(),
          requiredRoleIds: role ? [role.id] : [],
          minMemberDays: interaction.options.getInteger('days') ?? 0,
        },
        interaction.user.id,
        config,
      );
      return void (await interaction.editReply(ctx.t('giveaways.started', { channel: `<#${giveaway.channelId}>` })));
    }

    const giveaway = await ctx.db.giveaway.findUnique({ where: { id: interaction.options.getString('giveaway', true) } });
    if (!giveaway || giveaway.guildId !== interaction.guildId) return void (await reply('giveaways.notFound'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (sub === 'end') await service.end(giveaway, config);
      else if (sub === 'reroll') await service.end(giveaway, config, { reroll: interaction.options.getInteger('count') ?? 1 });
      else await service.cancel(giveaway, config);
    } catch (err) {
      return void (await interaction.editReply(ctx.t('giveaways.cannot', { reason: (err as Error).message })));
    }
    await interaction.editReply(ctx.t(`giveaways.done.${sub}`));
  },
});
