import { defineCommand } from '@bot/core';
import { chatInputApplicationCommandMention, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ApplicationCommand, Collection, Locale } from 'discord.js';
import type { GeneralConfig } from '../config.js';

export function formatCommandList(
  commands: Iterable<Pick<ApplicationCommand, 'id' | 'name' | 'description' | 'descriptionLocalizations'>>,
  locale: Locale | string,
): string {
  return [...commands]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cmd) => {
      const description = cmd.descriptionLocalizations?.[locale as Locale] ?? cmd.description;
      return `${chatInputApplicationCommandMention(cmd.name, cmd.id)} — ${description}`;
    })
    .join('\n');
}

export const help = defineCommand<GeneralConfig>({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands')
    .setDescriptionLocalizations({ ru: 'Показать доступные команды' }),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    let commands: Collection<string, ApplicationCommand> = await interaction.client.application.commands.fetch();
    if (commands.size === 0 && interaction.guild) {
      // В разработке команды регистрируются в тестовой гильдии, а не глобально.
      commands = await interaction.guild.commands.fetch();
    }

    const embed = new EmbedBuilder()
      .setTitle(ctx.t('general.help.title'))
      .setDescription(commands.size > 0 ? formatCommandList(commands.values(), interaction.locale) : ctx.t('general.help.empty'));

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});
