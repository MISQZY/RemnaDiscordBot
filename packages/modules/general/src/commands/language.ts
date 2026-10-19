import { Locale } from '@bot/contracts';
import { defineCommand, publishConfigInvalidation } from '@bot/core';
import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { GeneralConfig } from '../config.js';

/** Server language: the bot uses it for what everyone sees (logs, announcements, moderation results). */
export const language = defineCommand<GeneralConfig>({
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('Server language for public bot messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('language')
        .setDescription('Language')
        .setRequired(true)
        .addChoices({ name: 'Русский', value: 'ru' }, { name: 'English', value: 'en' }),
    ),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const locale = Locale.parse(interaction.options.getString('language', true));

    await ctx.db.guild.upsert({ where: { id: guildId }, create: { id: guildId, locale }, update: { locale } });
    await ctx.db.dashboardAuditLog.create({ data: { guildId, userId: interaction.user.id, action: 'guild.update', diff: { after: { locale } } } });
    ctx.guildLocales.invalidate(guildId);
    // Invalidate the language in other processes too (clusters, API, worker).
    await publishConfigInvalidation(ctx.redis, { guildId });

    await interaction.reply({ content: ctx.i18n.t(locale, 'general.language.changed'), flags: MessageFlags.Ephemeral });
  },
});
