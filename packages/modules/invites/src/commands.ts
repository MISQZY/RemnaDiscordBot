import { defineCommand } from '@bot/core';
import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { InvitesConfig } from './config.js';
import { countsOf, leaderboard } from './service.js';

export const invitesCommand = defineCommand<InvitesConfig>({
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invites')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription('How many members someone invited')
        .addUserOption((o) => o.setName('user').setDescription('Member; you by default')),
    )
    .addSubcommand((s) => s.setName('top').setDescription('Who invited the most')),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const config = await ctx.getConfig(guildId);
    if (interaction.options.getSubcommand() === 'top') {
      const top = await leaderboard(ctx, guildId, config, 10);
      const lines = top.map((c, i) => ctx.t('invites.topLine', { place: i + 1, user: `<@${c.userId}>`, count: c.total }));
      const embed = new EmbedBuilder().setTitle(ctx.t('invites.topTitle')).setDescription(lines.join('\n') || ctx.t('invites.noneYet'));
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }
    const user = interaction.options.getUser('user') ?? interaction.user;
    const counts = await countsOf(ctx, guildId, user.id, config);
    await interaction.reply({
      content: ctx.t('invites.counts', { user: `<@${user.id}>`, total: counts.total, joins: counts.joins, left: counts.left, fake: counts.fake }),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
});
