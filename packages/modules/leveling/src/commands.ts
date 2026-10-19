import { defineCommand, defineComponent, type InteractionContext } from '@bot/core';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildMember,
} from 'discord.js';
import type { LevelingConfig } from './config.js';
import { syncRewards } from './bot.js';
import { levelProgress, progressBar } from './formula.js';
import { LevelingService } from './service.js';

const PAGE_SIZE = 10;
export const COMPONENT_PREFIX = 'lvl';

async function leaderboardPage(ctx: InteractionContext<LevelingConfig>, guildId: string, page: number) {
  const { items, total } = await new LevelingService(ctx.db).leaderboard(guildId, page, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Лидерборд и карточку уровня видят все — на языке сервера.
  const lines = items.map((e) => `**${e.rank}.** <@${e.userId}> · ${ctx.tGuild('leveling.levelShort', { level: e.level })} · ${e.xp} XP`);

  const embed = new EmbedBuilder()
    .setTitle(ctx.tGuild('leveling.leaderboardTitle'))
    .setDescription(lines.length > 0 ? lines.join('\n') : ctx.tGuild('leveling.leaderboardEmpty'))
    .setFooter({ text: ctx.tGuild('leveling.page', { page: page + 1, pages }) });
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${COMPONENT_PREFIX}:page:${page - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${COMPONENT_PREFIX}:page:${page + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page + 1 >= pages),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

export const rank = defineCommand<LevelingConfig>({
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show level and XP')
    .setDescriptionLocalizations({ ru: 'Показать уровень и опыт' })
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('user').setNameLocalizations({ ru: 'участник' }).setDescription('Member').setDescriptionLocalizations({ ru: 'Участник' })),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const service = new LevelingService(ctx.db);
    const row = await service.get(interaction.guildId!, user.id);
    if (!row || row.xp === 0) {
      await interaction.reply({ content: ctx.t('leveling.noXp', { user: user.username }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    const { level, current, needed } = levelProgress(row.xp);
    const position = await service.rankOf(interaction.guildId!, row.xp);
    const embed = new EmbedBuilder()
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setColor(0x5865f2)
      .addFields(
        { name: ctx.tGuild('leveling.fields.level'), value: String(level), inline: true },
        { name: ctx.tGuild('leveling.fields.rank'), value: `#${position}`, inline: true },
        { name: ctx.tGuild('leveling.fields.messages'), value: String(row.messages), inline: true },
        { name: ctx.tGuild('leveling.fields.progress'), value: `${progressBar(current, needed)} ${current}/${needed} XP` },
      );
    await interaction.reply({ embeds: [embed] });
  },
});

export const leaderboard = defineCommand<LevelingConfig>({
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top members by XP')
    .setDescriptionLocalizations({ ru: 'Лучшие участники по опыту' })
    .setContexts(InteractionContextType.Guild),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    await interaction.reply(await leaderboardPage(ctx, interaction.guildId!, 0));
  },
});

/** Кнопки «◀ ▶» лидерборда: `lvl:page:<n>`. */
export const leaderboardPager = defineComponent<LevelingConfig>({
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.guildId) return;
    const page = Math.max(0, Number(interaction.customId.split(':')[2]) || 0);
    await interaction.update(await leaderboardPage(ctx, interaction.guildId, page));
  },
});

export const xp = defineCommand<LevelingConfig>({
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Change member XP')
    .setDescriptionLocalizations({ ru: 'Изменить опыт участника' })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('action')
        .setNameLocalizations({ ru: 'действие' })
        .setDescription('What to do')
        .setDescriptionLocalizations({ ru: 'Что сделать' })
        .setRequired(true)
        .addChoices(
          { name: 'Add', name_localizations: { ru: 'Добавить' }, value: 'add' },
          { name: 'Remove', name_localizations: { ru: 'Отнять' }, value: 'remove' },
          { name: 'Set', name_localizations: { ru: 'Установить' }, value: 'set' },
        ),
    )
    .addUserOption((o) => o.setName('user').setNameLocalizations({ ru: 'участник' }).setDescription('Member').setDescriptionLocalizations({ ru: 'Участник' }).setRequired(true))
    .addIntegerOption((o) =>
      o.setName('amount').setNameLocalizations({ ru: 'количество' }).setDescription('XP').setDescriptionLocalizations({ ru: 'Опыт' }).setRequired(true).setMinValue(0).setMaxValue(10_000_000),
    ),
  async execute(interaction, ctx) {
    const action = interaction.options.getString('action', true);
    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const service = new LevelingService(ctx.db);

    const current = (await service.get(interaction.guildId!, user.id))?.xp ?? 0;
    const target = action === 'set' ? amount : action === 'add' ? current + amount : Math.max(0, current - amount);
    const change = await service.setXp(interaction.guildId!, user.id, target);

    const member = interaction.options.getMember('user') as GuildMember | null;
    if (member) await syncRewards(member, change.row.level, await ctx.getConfig(interaction.guildId!), ctx.logger);

    await interaction.reply({
      content: ctx.t('leveling.xpChanged', { user: user.username, xp: change.row.xp, level: change.row.level }),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
});

export const commands = [rank, leaderboard, xp];
