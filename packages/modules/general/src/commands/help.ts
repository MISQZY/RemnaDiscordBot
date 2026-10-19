import { defineCommand, type AnyModule } from '@bot/core';
import { chatInputApplicationCommandMention, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { GeneralConfig } from '../config.js';

export interface HelpSection {
  title: string;
  lines: string[];
}

export interface HelpInput {
  modules: AnyModule[];
  enabled: ReadonlySet<string>;
  /** ID зарегистрированных в Discord команд — для кликабельных упоминаний. */
  commandIds: ReadonlyMap<string, string>;
  /** Команды гильдии, которых нет в модулях (пользовательские). */
  extraCommands: { name: string; description: string }[];
  locale: string;
  moduleName(id: string): string;
}

const mention = (name: string, ids: ReadonlyMap<string, string>) => {
  const id = ids.get(name);
  return id ? chatInputApplicationCommandMention(name, id) : `\`/${name}\``;
};

/** Разделы справки: команды включённых модулей, собранные из реестра автоматически. */
export function helpSections({ modules, enabled, commandIds, extraCommands, locale, moduleName }: HelpInput): HelpSection[] {
  const sections: HelpSection[] = [];
  for (const module of modules) {
    const commands = module.bot?.commands ?? [];
    if (commands.length === 0 || !enabled.has(module.id)) continue;
    sections.push({
      title: moduleName(module.id),
      lines: commands.map((command) => {
        const json = command.data.toJSON();
        const localized = json.description_localizations?.[locale as keyof typeof json.description_localizations];
        return `${mention(json.name, commandIds)} — ${localized ?? json.description}`;
      }),
    });
  }
  if (extraCommands.length > 0 && enabled.has('custom-commands')) {
    sections.push({
      title: moduleName('custom-commands'),
      lines: extraCommands.map((c) => `${mention(c.name, commandIds)} — ${c.description}`),
    });
  }
  return sections;
}

export const help = defineCommand<GeneralConfig>({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands')
    .setDescriptionLocalizations({ ru: 'Показать доступные команды' }),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [global, guild] = await Promise.all([
      interaction.client.application.commands.fetch().catch(() => null),
      interaction.guild?.commands.fetch().catch(() => null),
    ]);
    const commandIds = new Map<string, string>();
    for (const command of [...(global?.values() ?? []), ...(guild?.values() ?? [])]) commandIds.set(command.name, command.id);

    const moduleCommands = new Set(ctx.registry.allCommands().map(({ item }) => item.data.name));
    const modules = ctx.registry.all();
    const enabled = new Set(interaction.guildId ? await ctx.config.enabledModules(interaction.guildId) : modules.map((m) => m.id));

    const sections = helpSections({
      modules,
      enabled,
      commandIds,
      extraCommands: [...(guild?.values() ?? [])].filter((c) => !moduleCommands.has(c.name)).map((c) => ({ name: c.name, description: c.description })),
      locale: interaction.locale,
      moduleName: (id) => (ctx.i18n.has(`${id}.name`, ctx.locale) ? ctx.t(`${id}.name`) : id),
    });

    const embed = new EmbedBuilder()
      .setTitle(ctx.t('general.help.title'))
      .addFields(sections.slice(0, 25).map((s) => ({ name: s.title, value: s.lines.join('\n').slice(0, 1024) })));
    const disabled = modules.filter((m) => !enabled.has(m.id) && (m.bot?.commands?.length ?? 0) > 0).length;
    if (disabled > 0 && interaction.guildId) embed.setFooter({ text: ctx.t('general.help.disabled', { count: disabled }) });
    if (sections.length === 0) embed.setDescription(ctx.t('general.help.empty'));

    await interaction.editReply({ embeds: [embed] });
  },
});
