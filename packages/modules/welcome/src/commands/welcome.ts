import { defineCommand } from '@bot/core';
import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type GuildMember } from 'discord.js';
import { WelcomeKind, type WelcomeConfig } from '../config.js';
import { greet } from '../greet.js';

export const welcomeCommand = defineCommand<WelcomeConfig>({
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Welcome messages')
    .setDescriptionLocalizations({ ru: 'Приветствия' })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Send a test message as if you just joined or left')
        .setDescriptionLocalizations({ ru: 'Отправить тестовое сообщение, как будто вы зашли или вышли' })
        .addStringOption((option) =>
          option
            .setName('kind')
            .setNameLocalizations({ ru: 'тип' })
            .setDescription('Which message to send')
            .setDescriptionLocalizations({ ru: 'Какое сообщение отправить' })
            .setRequired(true)
            .addChoices(
              { name: 'Join', name_localizations: { ru: 'Приветствие' }, value: 'join' },
              { name: 'Leave', name_localizations: { ru: 'Прощание' }, value: 'leave' },
              { name: 'Direct message', name_localizations: { ru: 'Личное сообщение' }, value: 'dm' },
            ),
        ),
    ),
  cooldownMs: 10_000,
  async execute(interaction, ctx) {
    const kind = WelcomeKind.parse(interaction.options.getString('kind', true));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await ctx.getConfig(interaction.guildId!);
    const sent = await greet(kind, interaction.member as GuildMember, config, ctx.logger, { force: true });
    await interaction.editReply(ctx.t(sent ? 'welcome.test.sent' : 'welcome.test.notSent'));
  },
});
