import { defineCommand, defineComponent } from '@bot/core';
import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type GuildMember } from 'discord.js';
import { STATUSES, type SuggestionsConfig, type SuggestionStatus } from './config.js';
import { isFinal, SuggestionService, suggestionMessage } from './service.js';

export const isReviewer = (member: GuildMember, config: SuggestionsConfig) =>
  member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.some((r) => config.reviewerRoleIds.includes(r.id));

export const suggestCommand = defineCommand<SuggestionsConfig>({
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggest something for the server')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('text').setDescription('Your suggestion').setRequired(true).setMinLength(5).setMaxLength(2000)),
  cooldownMs: 60_000,
  async execute(interaction, ctx) {
    const config = await ctx.getConfig(interaction.guildId!);
    if (!config.channelId) return void (await interaction.reply({ content: ctx.t('suggestions.off'), flags: MessageFlags.Ephemeral }));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const row = await new SuggestionService(ctx).create(interaction.guildId!, interaction.user.id, interaction.options.getString('text', true), config);
    await interaction.editReply(ctx.t('suggestions.sent', { number: row.number, channel: `<#${row.channelId}>` }));
  },
});

export const suggestionCommand = defineCommand<SuggestionsConfig>({
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('Decide on a suggestion')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('number').setDescription('Suggestion number').setRequired(true).setMinValue(1))
    .addStringOption((o) =>
      o
        .setName('status')
        .setDescription('Decision')
        .setRequired(true)
        .addChoices(...STATUSES.map((value) => ({ name: value, value }))),
    )
    .addStringOption((o) => o.setName('response').setDescription('Answer to the author').setMaxLength(1000)),
  cooldownMs: 2_000,
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const config = await ctx.getConfig(interaction.guildId);
    if (!isReviewer(interaction.member, config)) return void (await interaction.reply({ content: ctx.t('suggestions.noAccess'), flags: MessageFlags.Ephemeral }));
    const number = interaction.options.getInteger('number', true);
    const status = interaction.options.getString('status', true) as SuggestionStatus;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await new SuggestionService(ctx).decide(interaction.guildId, number, status, interaction.user.id, interaction.options.getString('response'), config);
    } catch {
      return void (await interaction.editReply(ctx.t('suggestions.notFound')));
    }
    await interaction.editReply(ctx.t('suggestions.decided', { number, status: ctx.t(`suggestions.statuses.${status}`) }));
  },
});

/** Votes: the message is updated right in the button's answer. */
export const voteComponent = defineComponent<SuggestionsConfig>({
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, direction, id] = interaction.customId.split(':');
    const suggestion = id ? await ctx.db.suggestion.findUnique({ where: { id } }) : null;
    if (!suggestion || suggestion.guildId !== interaction.guildId || isFinal(suggestion.status as SuggestionStatus)) {
      return void (await interaction.reply({ content: ctx.t('suggestions.closed'), flags: MessageFlags.Ephemeral }));
    }
    const service = new SuggestionService(ctx);
    const updated = await service.vote(suggestion, interaction.user.id, direction === 'up' ? 1 : -1);
    const { embeds, components } = suggestionMessage(await service.translator(interaction.guildId), updated, await ctx.getConfig(interaction.guildId));
    await interaction.update({ embeds, components });
  },
});
