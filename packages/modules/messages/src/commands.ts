import { defineCommand } from '@bot/core';
import { formatDuration, parseDuration } from '@bot/templates';
import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { MessagesConfig } from './config.js';
import { createReminder, deleteReminder } from './reminders.js';
import { MessageService } from './service.js';

/** A reminder can be at most a year away. */
const MAX_REMIND_SEC = 365 * 86_400;

export const remindCommand = defineCommand<MessagesConfig>({
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Reminders')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('me')
        .setDescription('Remind me later')
        .addStringOption((o) => o.setName('in').setDescription('When: 10m, 2h, 1d…').setRequired(true).setMaxLength(20))
        .addStringOption((o) => o.setName('text').setDescription('What to remind about').setRequired(true).setMaxLength(500))
        .addBooleanOption((o) => o.setName('dm').setDescription('Remind in DMs')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('My reminders'))
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete a reminder')
        .addStringOption((o) => o.setName('id').setDescription('Reminder from the list').setRequired(true).setAutocomplete(true)),
    ),
  cooldownMs: 2_000,
  async autocomplete(interaction, ctx) {
    const reminders = await ctx.db.reminder.findMany({ where: { guildId: interaction.guildId!, userId: interaction.user.id }, orderBy: { runAt: 'asc' }, take: 25 });
    await interaction.respond(reminders.map((r) => ({ name: `${r.runAt.toISOString().slice(0, 16).replace('T', ' ')} · ${r.text}`.slice(0, 100), value: r.id })));
  },
  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    const config = await ctx.getConfig(guildId);
    if (!config.reminders) return void (await reply(ctx.t('messages.remind.off')));
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const reminders = await ctx.db.reminder.findMany({ where: { guildId, userId: interaction.user.id }, orderBy: { runAt: 'asc' } });
      if (reminders.length === 0) return void (await reply(ctx.t('messages.remind.none')));
      return void (await reply(reminders.map((r) => `<t:${Math.floor(r.runAt.getTime() / 1000)}:R> · ${r.text}`).join('\n').slice(0, 2000)));
    }
    if (sub === 'delete') {
      const deleted = await deleteReminder(ctx, guildId, interaction.user.id, interaction.options.getString('id', true));
      return void (await reply(ctx.t(deleted ? 'messages.remind.deleted' : 'messages.remind.notFound')));
    }

    const seconds = parseDuration(interaction.options.getString('in', true));
    if (!seconds || seconds > MAX_REMIND_SEC) return void (await reply(ctx.t('messages.remind.badTime')));
    if ((await ctx.db.reminder.count({ where: { guildId, userId: interaction.user.id } })) >= config.maxRemindersPerUser) {
      return void (await reply(ctx.t('messages.remind.limit', { max: config.maxRemindersPerUser })));
    }
    const runAt = new Date(Date.now() + seconds * 1000);
    await createReminder(ctx, {
      guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      text: interaction.options.getString('text', true),
      dm: interaction.options.getBoolean('dm') ?? false,
      runAt,
    });
    await reply(ctx.t('messages.remind.set', { in: formatDuration(seconds, ctx.locale), time: `<t:${Math.floor(runAt.getTime() / 1000)}:f>` }));
  },
});

export const stickyCommand = defineCommand<MessagesConfig>({
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('A message kept at the bottom of the channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Keep this text at the bottom of the channel')
        .addStringOption((o) => o.setName('text').setDescription('Text').setRequired(true).setMaxLength(2000))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel; the current one by default').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Stop keeping the message')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel; the current one by default').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    ),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
    const service = new MessageService(ctx);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.options.getSubcommand() === 'remove') {
      const exists = await ctx.db.stickyMessage.findUnique({ where: { channelId } });
      if (!exists || exists.guildId !== guildId) return void (await interaction.editReply(ctx.t('messages.sticky.none')));
      await service.deleteSticky(guildId, channelId);
      return void (await interaction.editReply(ctx.t('messages.sticky.removed', { channel: `<#${channelId}>` })));
    }
    await service.saveSticky(guildId, channelId, { message: { content: interaction.options.getString('text', true) }, enabled: true }, interaction.user.id);
    await interaction.editReply(ctx.t('messages.sticky.set', { channel: `<#${channelId}>` }));
  },
});
