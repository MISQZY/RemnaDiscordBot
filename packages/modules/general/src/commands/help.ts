import { defineCommand, localizeCommand, type AnyModule } from '@bot/core';
import type { I18n } from '@bot/i18n';
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
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
  /** Словари модулей — тексты команд берутся из них. */
  i18n: I18n;
  moduleName(id: string): string;
}

/**
 * Упоминание команды. Discord подсвечивает только конечные команды, поэтому путь
 * включает подкоманду и группу: `</modules enable:id>`. Без ID — просто код.
 */
const mention = (path: string[], ids: ReadonlyMap<string, string>) => {
  const id = ids.get(path[0]!);
  return id ? `</${path.join(' ')}:${id}>` : `\`/${path.join(' ')}\``;
};

interface CommandNode {
  name: string;
  type?: number;
  description: string;
  description_localizations?: Partial<Record<string, string | null>> | null;
  options?: CommandNode[];
}

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;

/** Конечные команды: сама команда или каждая её подкоманда (с учётом групп). */
function leaves(node: CommandNode, path: string[] = []): { path: string[]; node: CommandNode }[] {
  const children = (node.options ?? []).filter((o) => o.type === SUBCOMMAND || o.type === SUBCOMMAND_GROUP);
  const current = [...path, node.name];
  if (children.length === 0) return [{ path: current, node }];
  return children.flatMap((child) => leaves(child, current));
}

/** Разделы справки: команды включённых модулей, собранные из реестра автоматически. */
export function helpSections({ modules, enabled, commandIds, extraCommands, locale, i18n, moduleName }: HelpInput): HelpSection[] {
  const sections: HelpSection[] = [];
  for (const module of modules) {
    const commands = module.bot?.commands ?? [];
    if (commands.length === 0 || !enabled.has(module.id)) continue;
    sections.push({
      title: moduleName(module.id),
      lines: commands.flatMap((command) =>
        leaves(localizeCommand(command.data.toJSON(), i18n, module.id) as CommandNode).map(({ path, node }) => {
          const localized = node.description_localizations?.[locale];
          return `${mention(path, commandIds)} — ${localized ?? node.description}`;
        }),
      ),
    });
  }
  if (extraCommands.length > 0 && enabled.has('custom-commands')) {
    sections.push({
      title: moduleName('custom-commands'),
      lines: extraCommands.map((c) => `${mention([c.name], commandIds)} — ${c.description}`),
    });
  }
  return sections;
}

export const help = defineCommand<GeneralConfig>({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands'),
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
      i18n: ctx.i18n,
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
