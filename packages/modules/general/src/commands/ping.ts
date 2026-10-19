import { defineCommand } from '@bot/core';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { GeneralConfig } from '../config.js';

export const ping = defineCommand<GeneralConfig>({
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const roundtrip = Math.max(Date.now() - interaction.createdTimestamp, 0);
    await interaction.reply({
      content: ctx.t('general.ping.reply', { ws: Math.round(ctx.client.ws.ping), roundtrip }),
      flags: MessageFlags.Ephemeral,
    });
  },
});
