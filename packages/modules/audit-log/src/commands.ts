import { defineCommand, type InteractionContext } from '@bot/core';
import {
  channelMention,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  roleMention,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type SlashCommandStringOption,
} from 'discord.js';
import { LogCategory, type AuditLogConfig } from './config.js';

type Ctx = InteractionContext<AuditLogConfig>;

const categoryOption = (o: SlashCommandStringOption, { all = false } = {}) =>
  o
    .setName('category')
    .setDescription('Event category')
    .setRequired(true)
    .addChoices(
      ...LogCategory.options.map((value) => ({ name: value, value })),
      ...(all ? [{ name: 'all', value: 'all' }] : []),
    );

const reply = (interaction: ChatInputCommandInteraction, content: string) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

async function updateConfig(ctx: Ctx, interaction: ChatInputCommandInteraction, change: (config: AuditLogConfig) => AuditLogConfig) {
  const guildId = interaction.guildId!;
  const config = await ctx.getConfig(guildId);
  await ctx.config.update(guildId, ctx.moduleId, { config: change(structuredClone(config)) }, interaction.user.id);
}

/** Whether the bot can post log embeds to the channel. */
function canPost(channel: GuildBasedChannel): boolean {
  const me = channel.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  return Boolean(perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]));
}

export const logs = defineCommand<AuditLogConfig>({
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configure the audit log')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('show').setDescription('Show log channels and exclusions'))
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Log a category to a channel')
        .addStringOption((o) => categoryOption(o))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Log channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('disable')
        .setDescription('Stop logging a category')
        .addStringOption((o) => categoryOption(o, { all: true })),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('ignore')
        .setDescription('Channels and roles the log skips')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Skip a channel or a role')
            .addChannelOption((o) => o.setName('channel').setDescription('Channel'))
            .addRoleOption((o) => o.setName('role').setDescription('Role')),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Log a channel or a role again')
            .addChannelOption((o) => o.setName('channel').setDescription('Channel'))
            .addRoleOption((o) => o.setName('role').setDescription('Role')),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('bots')
        .setDescription('Log or skip bot actions')
        .addBooleanOption((o) => o.setName('ignore').setDescription('Skip bots').setRequired(true)),
    ),
  cooldownMs: 2_000,

  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const category = (key: string) => ctx.t(`audit-log.categories.${key}`);

    if (sub === 'show') {
      const config = await ctx.getConfig(guildId);
      const none = ctx.t('audit-log.settings.none');
      const list = (ids: string[], mention: (id: string) => string) => (ids.length > 0 ? ids.map(mention).join(' ') : none);
      const embed = new EmbedBuilder()
        .setTitle(ctx.t('audit-log.name'))
        .setDescription(
          LogCategory.options
            .map((c) => `**${category(c)}** · ${config.channels[c] ? channelMention(config.channels[c]) : ctx.t('audit-log.settings.off')}`)
            .join('\n'),
        )
        .addFields(
          { name: ctx.t('audit-log.settings.ignoredChannels'), value: list(config.ignoredChannelIds, channelMention) },
          { name: ctx.t('audit-log.settings.ignoredRoles'), value: list(config.ignoredRoleIds, roleMention) },
          { name: ctx.t('audit-log.settings.bots'), value: ctx.t(config.ignoreBots ? 'audit-log.settings.botsIgnored' : 'audit-log.settings.botsLogged') },
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'set') {
      const key = LogCategory.parse(interaction.options.getString('category', true));
      const channel = interaction.options.getChannel('channel', true) as GuildBasedChannel;
      if (!canPost(channel)) return void (await reply(interaction, ctx.t('audit-log.settings.noAccess', { channel: channelMention(channel.id) })));
      await updateConfig(ctx, interaction, (c) => ({ ...c, channels: { ...c.channels, [key]: channel.id } }));
      await reply(interaction, ctx.t('audit-log.settings.channelSet', { category: category(key), channel: channelMention(channel.id) }));
      return;
    }

    if (sub === 'disable') {
      const value = interaction.options.getString('category', true);
      const keys = value === 'all' ? LogCategory.options : [LogCategory.parse(value)];
      await updateConfig(ctx, interaction, (c) => ({ ...c, channels: { ...c.channels, ...Object.fromEntries(keys.map((k) => [k, null])) } }));
      await reply(interaction, value === 'all' ? ctx.t('audit-log.settings.allDisabled') : ctx.t('audit-log.settings.disabled', { category: category(keys[0]!) }));
      return;
    }

    if (sub === 'bots') {
      const ignore = interaction.options.getBoolean('ignore', true);
      await updateConfig(ctx, interaction, (c) => ({ ...c, ignoreBots: ignore }));
      await reply(interaction, ctx.t(ignore ? 'audit-log.settings.botsIgnored' : 'audit-log.settings.botsLogged'));
      return;
    }

    if (group === 'ignore') {
      const channel = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');
      if (!channel && !role) return void (await reply(interaction, ctx.t('audit-log.settings.pickTarget')));
      const add = sub === 'add';
      const apply = (ids: string[], id: string | undefined, max: number) =>
        !id ? ids : add ? [...new Set([...ids, id])].slice(0, max) : ids.filter((x) => x !== id);
      await updateConfig(ctx, interaction, (c) => ({
        ...c,
        ignoredChannelIds: apply(c.ignoredChannelIds, channel?.id, 100),
        ignoredRoleIds: apply(c.ignoredRoleIds, role?.id, 50),
      }));
      const targets = [channel && channelMention(channel.id), role && roleMention(role.id)].filter(Boolean).join(', ');
      await reply(interaction, ctx.t(add ? 'audit-log.settings.ignored' : 'audit-log.settings.unignored', { targets }));
    }
  },
});

export const commands = [logs];
