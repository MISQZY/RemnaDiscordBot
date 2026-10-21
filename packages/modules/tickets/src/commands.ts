import { defineCommand } from '@bot/core';
import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { isSupport, mayClose, ticketOfChannel } from './bot.js';
import type { TicketsConfig } from './config.js';
import { toPanel } from './panel.js';
import { TicketService } from './service.js';

export const ticketCommand = defineCommand<TicketsConfig>({
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage the ticket of this channel')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('Close this ticket')
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a member to this ticket')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a member from this ticket')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('claim').setDescription('Take this ticket'))
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Rename this ticket')
        .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90)),
    ),
  cooldownMs: 2_000,
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    const ticket = await ticketOfChannel(ctx, interaction.channelId);
    if (!ticket) return void (await reply(ctx.t('tickets.notTicket')));
    const config = await ctx.getConfig(interaction.guildId);
    const service = new TicketService(ctx);
    const sub = interaction.options.getSubcommand();

    if (sub === 'close') {
      if (!(await mayClose(ctx, interaction.member, ticket, config))) return void (await reply(ctx.t('tickets.noAccess')));
      await reply(ctx.t('tickets.closing'));
      await service.close(ticket, config, { by: interaction.user.id, reason: interaction.options.getString('reason') });
      return;
    }

    const row = ticket.panelId ? await ctx.db.ticketPanel.findUnique({ where: { id: ticket.panelId } }) : null;
    const category = row ? (toPanel(row).categories.find((c) => c.id === ticket.categoryId) ?? null) : null;
    if (!isSupport(interaction.member, config, category)) return void (await reply(ctx.t('tickets.noAccess')));

    if (sub === 'add' || sub === 'remove') {
      const user = interaction.options.getUser('user', true);
      if (sub === 'remove' && user.id === ticket.ownerId) return void (await reply(ctx.t('tickets.ownerStays')));
      await service.setAccess(ticket, user.id, sub === 'add');
      await interaction.reply({ content: ctx.tGuild(sub === 'add' ? 'tickets.added' : 'tickets.removed', { user: `<@${user.id}>` }), allowedMentions: { parse: [] } });
      return;
    }
    if (sub === 'claim') {
      const claimed = await service.claim(ticket, interaction.user.id);
      return void (await reply(claimed ? ctx.t('tickets.youClaimed') : ctx.t('tickets.takenBy', { user: `<@${ticket.claimedBy}>` })));
    }
    const name = interaction.options.getString('name', true);
    await interaction.channel?.edit({ name }).catch(() => undefined);
    await reply(ctx.t('tickets.renamed', { name }));
  },
});
