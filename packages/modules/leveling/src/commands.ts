import { defineCommand, defineComponent, type InteractionContext } from '@bot/core';
import { UserDirectory } from '@bot/discord';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  GuildMember,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { LevelingConfig } from './config.js';
import { syncRewards } from './bot.js';
import { levelProgress, progressBar } from './formula.js';
import { withNames } from './names.js';
import { rankCardRendererFromEnv } from './rank-card.js';
import { LevelingService } from './service.js';
import { levels } from './settings.js';

const PAGE_SIZE = 10;
export const COMPONENT_PREFIX = 'lvl';
/** The `/rank` picture; without a renderer configured, an embed. */
const rankCards = rankCardRendererFromEnv();

async function leaderboardPage(ctx: InteractionContext<LevelingConfig>, guildId: string, page: number) {
  const board = await new LevelingService(ctx.db).leaderboard(guildId, page, PAGE_SIZE);
  const items = await withNames(board.items, new UserDirectory(ctx.redis, ctx.rest));
  const { total } = board;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Everyone sees the leaderboard and the rank card — use the server's language.
  // By name: a mention of a member the reader's Discord has not loaded shows as a bare ID.
  const lines = items.map(
    (e) => `**${e.rank}.** ${e.username ? escapeMarkdown(e.username) : `<@${e.userId}>`} · ${ctx.tGuild('leveling.levelShort', { level: e.level })} · ${e.xp} XP`,
  );

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
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('user').setDescription('Member')),
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
    const embed = () =>
      new EmbedBuilder()
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setColor(0x5865f2)
        .addFields(
          { name: ctx.tGuild('leveling.fields.level'), value: String(level), inline: true },
          { name: ctx.tGuild('leveling.fields.rank'), value: `#${position}`, inline: true },
          { name: ctx.tGuild('leveling.fields.messages'), value: String(row.messages), inline: true },
          { name: ctx.tGuild('leveling.fields.progress'), value: `${progressBar(current, needed)} ${current}/${needed} XP` },
        );
    if (!rankCards) {
      await interaction.reply({ embeds: [embed()] });
      return;
    }

    // Drawing takes longer than the 3 s an interaction may wait for its reply.
    await interaction.deferReply();
    const target = interaction.options.getUser('user') ? interaction.options.getMember('user') : interaction.member;
    const member = target instanceof GuildMember ? target : null;
    try {
      const png = await rankCards.render({
        locale: ctx.guildLocale,
        user: {
          id: user.id,
          name: member?.displayName ?? user.displayName,
          avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 256 }),
        },
        level,
        rank: position,
        current,
        needed,
        messages: row.messages,
      });
      await interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'rank.png' })] });
    } catch (err) {
      ctx.logger.warn({ err }, 'Rank card failed, answering with an embed');
      await interaction.editReply({ embeds: [embed()] });
    }
  },
});

export const leaderboard = defineCommand<LevelingConfig>({
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top members by XP')
    .setContexts(InteractionContextType.Guild),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    await interaction.reply(await leaderboardPage(ctx, interaction.guildId!, 0));
  },
});

/** Leaderboard "◀ ▶" buttons: `lvl:page:<n>`. */
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('What to do')
        .setRequired(true)
        .addChoices(
          { name: 'Add', value: 'add' },
          { name: 'Remove', value: 'remove' },
          { name: 'Set', value: 'set' },
        ),
    )
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('XP').setRequired(true).setMinValue(0).setMaxValue(10_000_000),
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

export const commands = [rank, leaderboard, xp, levels];
