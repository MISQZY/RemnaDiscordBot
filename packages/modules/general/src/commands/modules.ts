import { defineCommand, type InteractionContext } from '@bot/core';
import { EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { GeneralConfig } from '../config.js';

const moduleName = (ctx: InteractionContext<GeneralConfig>, id: string) =>
  ctx.i18n.has(`${id}.name`, ctx.locale) ? ctx.t(`${id}.name`) : id;

/** Modules that can be toggled (built-in ones are always enabled). */
const toggleable = (ctx: InteractionContext<GeneralConfig>) => ctx.registry.all().filter((m) => !m.alwaysEnabled);

export const modules = defineCommand<GeneralConfig>({
  data: new SlashCommandBuilder()
    .setName('modules')
    .setDescription('Enable or disable bot modules')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub.setName('list').setDescription('Show modules and their status'))
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Enable a module')
        .addStringOption((o) =>
          o.setName('module').setDescription('Module').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Disable a module')
        .addStringOption((o) =>
          o.setName('module').setDescription('Module').setRequired(true).setAutocomplete(true),
        ),
    ),
  cooldownMs: 2_000,

  async autocomplete(interaction, ctx) {
    const query = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      toggleable(ctx)
        .map((m) => ({ name: `${moduleName(ctx, m.id)} (${m.id})`, value: m.id }))
        .filter((choice) => choice.name.toLowerCase().includes(query))
        .slice(0, 25),
    );
  },

  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const lines = await Promise.all(
        ctx.registry.all().map(async (m) => {
          const enabled = await ctx.config.isEnabled(guildId, m.id);
          return `${enabled ? '🟢' : '⚪'} **${moduleName(ctx, m.id)}** · \`${m.id}\``;
        }),
      );
      const embed = new EmbedBuilder().setTitle(ctx.t('general.modules.title')).setDescription(lines.join('\n')).setFooter({ text: ctx.t('general.modules.hint') });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const id = interaction.options.getString('module', true);
    const target = toggleable(ctx).find((m) => m.id === id);
    if (!target) {
      await interaction.reply({ content: ctx.t('general.modules.unknown', { module: id }), flags: MessageFlags.Ephemeral });
      return;
    }

    const enabled = sub === 'enable';
    await ctx.config.update(guildId, id, { enabled }, interaction.user.id);
    await ctx.db.dashboardAuditLog.create({
      data: { guildId, userId: interaction.user.id, moduleId: id, action: enabled ? 'module.enable' : 'module.disable' },
    });
    await interaction.reply({
      content: ctx.t(enabled ? 'general.modules.enabled' : 'general.modules.disabled', { module: moduleName(ctx, id) }),
      flags: MessageFlags.Ephemeral,
    });
  },
});
