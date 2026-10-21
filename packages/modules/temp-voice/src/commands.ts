import { defineCommand } from '@bot/core';
import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { applyAction } from './bot.js';
import type { Action, TempVoiceConfig } from './config.js';

export const voiceCommand = defineCommand<TempVoiceConfig>({
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Manage your temporary voice channel')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('lock').setDescription('Nobody else can join'))
    .addSubcommand((s) => s.setName('unlock').setDescription('Anyone can join again'))
    .addSubcommand((s) => s.setName('hide').setDescription('Hide the channel from others'))
    .addSubcommand((s) => s.setName('unhide').setDescription('Show the channel again'))
    .addSubcommand((s) =>
      s
        .setName('limit')
        .setDescription('Limit the number of members')
        .addIntegerOption((o) => o.setName('count').setDescription('0 — no limit').setRequired(true).setMinValue(0).setMaxValue(99)),
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Rename the channel')
        .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s
        .setName('kick')
        .setDescription('Remove a member and keep them out')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('transfer')
        .setDescription('Give the channel to another member in it')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('claim').setDescription('Take the channel when its owner has left')),
  cooldownMs: 2_000,
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const channel = interaction.member.voice.channel;
    if (!channel) return void (await interaction.reply({ content: ctx.t('temp-voice.replies.joinFirst'), flags: MessageFlags.Ephemeral }));
    const action = interaction.options.getSubcommand() as Action;
    const value =
      action === 'limit'
        ? String(interaction.options.getInteger('count', true))
        : action === 'rename'
          ? interaction.options.getString('name', true)
          : action === 'kick' || action === 'transfer'
            ? interaction.options.getUser('user', true).id
            : undefined;
    const reply = await applyAction(ctx, interaction.member, channel, action, value);
    await interaction.reply({ content: ctx.t(`temp-voice.replies.${reply.key}`, reply.vars), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
});
