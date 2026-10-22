import { defineComponent, type BotModuleContext, type InteractionContext } from '@bot/core';
import { memberTemplateVars } from '@bot/discord';
import type { Ticket } from '@bot/db';
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type Message,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { TicketCategory, TicketsConfig } from './config.js';
import { PREFIX, toPanel } from './panel.js';
import { channelKey, supportRolesOf, TicketService } from './service.js';

type Ctx = InteractionContext<TicketsConfig>;
const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const, allowedMentions: { parse: [] } });

/** Support of the ticket's category, or anyone who manages channels or threads. */
export function isSupport(member: GuildMember, config: TicketsConfig, category: Pick<TicketCategory, 'supportRoleIds'> | null): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageThreads) || member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  const roles = supportRolesOf(config, category);
  return member.roles.cache.some((r) => roles.includes(r.id));
}

async function categoryOf(ctx: Ctx, ticket: Ticket): Promise<TicketCategory | null> {
  if (!ticket.panelId) return null;
  const row = await ctx.db.ticketPanel.findUnique({ where: { id: ticket.panelId } });
  return row ? (toPanel(row).categories.find((c) => c.id === ticket.categoryId) ?? null) : null;
}

/** The open ticket of this channel, if it is one. */
export async function ticketOfChannel(ctx: Pick<Ctx, 'db'>, channelId: string): Promise<Ticket | null> {
  const ticket = await ctx.db.ticket.findUnique({ where: { channelId } });
  return ticket?.status === 'open' ? ticket : null;
}

/** May close: the owner, or the support. */
export async function mayClose(ctx: Ctx, member: GuildMember, ticket: Ticket, config: TicketsConfig): Promise<boolean> {
  return ticket.ownerId === member.id || isSupport(member, config, await categoryOf(ctx, ticket));
}

async function openTicket(
  interaction: MessageComponentInteraction<'cached'> | ModalSubmitInteraction<'cached'>,
  ctx: Ctx,
  panelId: string,
  category: TicketCategory,
  answers: { question: string; answer: string }[],
): Promise<void> {
  const config = await ctx.getConfig(interaction.guildId);
  const service = new TicketService(ctx);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // The limit was checked before the form, but a double click or two forms open at once would both pass it: one
  // opening per member at a time (across clusters), and the limit checked again inside it.
  const lock = `tickets:opening:${interaction.guildId}:${interaction.user.id}`;
  if (!(await ctx.redis.set(lock, '1', 'PX', OPENING_LOCK_MS, 'NX'))) return void (await interaction.editReply(ctx.t('tickets.limit', { channel: '—' })));
  try {
    if ((await service.openCount(interaction.guildId, interaction.user.id)) >= config.maxOpenPerUser) {
      const existing = await service.findOpenByOwner(interaction.guildId, interaction.user.id);
      return void (await interaction.editReply(ctx.t('tickets.limit', { channel: existing ? `<#${existing.channelId}>` : '—' })));
    }
    const ticket = await service.open({
      guildId: interaction.guildId,
      owner: { id: interaction.user.id, vars: memberTemplateVars(interaction.member) },
      config,
      panelId,
      category,
      answers,
    });
    await interaction.editReply(ctx.t('tickets.opened', { channel: `<#${ticket.channelId}>` }));
  } finally {
    await ctx.redis.del(lock);
  }
}

/** Longer than opening takes (a channel, its overwrites, the first message). */
const OPENING_LOCK_MS = 30_000;

async function startOpen(interaction: MessageComponentInteraction<'cached'>, ctx: Ctx, panelId: string, categoryId: string | undefined): Promise<void> {
  const config = await ctx.getConfig(interaction.guildId);
  if (!config.parentChannelId) return void (await interaction.reply(ephemeral(ctx.t('tickets.notSetUp'))));
  const row = await ctx.db.ticketPanel.findUnique({ where: { id: panelId } });
  const category = row && row.guildId === interaction.guildId ? toPanel(row).categories.find((c) => c.id === categoryId) : undefined;
  if (!category) return void (await interaction.reply(ephemeral(ctx.t('tickets.panelMissing'))));

  const service = new TicketService(ctx);
  if ((await service.openCount(interaction.guildId, interaction.user.id)) >= config.maxOpenPerUser) {
    const existing = await service.findOpenByOwner(interaction.guildId, interaction.user.id);
    return void (await interaction.reply(ephemeral(ctx.t('tickets.limit', { channel: existing ? `<#${existing.channelId}>` : '—' }))));
  }

  if (category.questions.length === 0) return openTicket(interaction, ctx, panelId, category, []);
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:form:${panelId}:${category.id}`).setTitle(category.label.slice(0, 45));
  for (const q of category.questions) {
    const input = new TextInputBuilder()
      .setCustomId(q.id)
      .setLabel(q.label)
      .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required)
      .setMaxLength(q.long ? 1000 : 200);
    if (q.placeholder) input.setPlaceholder(q.placeholder);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  await interaction.showModal(modal);
  // A menu keeps the picked option selected: put it back so the same category can be picked again.
  if (interaction.isStringSelectMenu()) await interaction.message.edit({ components: interaction.message.components }).catch(() => undefined);
}

export const ticketComponent = defineComponent<TicketsConfig>({
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const [, action, a, b] = interaction.customId.split(':');

    if (interaction.isModalSubmit()) {
      if (action === 'form' && a && b) {
        // Ids in a custom_id come back from the client: the panel must be this server's.
        const row = await ctx.db.ticketPanel.findUnique({ where: { id: a } });
        const category = row && row.guildId === interaction.guildId ? toPanel(row).categories.find((c) => c.id === b) : undefined;
        if (!category) return void (await interaction.reply(ephemeral(ctx.t('tickets.panelMissing'))));
        const answers = category.questions.map((q) => ({ question: q.label, answer: interaction.fields.getTextInputValue(q.id).trim() }));
        return openTicket(interaction, ctx, a, category, answers);
      }
      if (action === 'closeform' && a) {
        const ticket = await ctx.db.ticket.findUnique({ where: { id: a } });
        const config = await ctx.getConfig(interaction.guildId);
        if (!ticket || ticket.guildId !== interaction.guildId || ticket.status !== 'open') return void (await interaction.reply(ephemeral(ctx.t('tickets.alreadyClosed'))));
        if (!(await mayClose(ctx, interaction.member, ticket, config))) return void (await interaction.reply(ephemeral(ctx.t('tickets.noAccess'))));
        await interaction.reply(ephemeral(ctx.t('tickets.closing')));
        await new TicketService(ctx).close(ticket, config, { by: interaction.user.id, reason: interaction.fields.getTextInputValue('reason').trim() || null });
      }
      return;
    }

    if (action === 'open' && a) {
      const categoryId = interaction.isStringSelectMenu() ? interaction.values[0] : b;
      return startOpen(interaction, ctx, a, categoryId);
    }
    if (!a) return;
    const ticket = await ctx.db.ticket.findUnique({ where: { id: a } });
    if (!ticket || ticket.guildId !== interaction.guildId || ticket.status !== 'open') return void (await interaction.reply(ephemeral(ctx.t('tickets.alreadyClosed'))));
    const config = await ctx.getConfig(interaction.guildId);

    if (action === 'close') {
      if (!(await mayClose(ctx, interaction.member, ticket, config))) return void (await interaction.reply(ephemeral(ctx.t('tickets.noAccess'))));
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${PREFIX}:closeform:${ticket.id}`)
          .setTitle(ctx.t('tickets.closeTitle').slice(0, 45))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId('reason').setLabel(ctx.t('tickets.reason')).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
            ),
          ),
      );
      return;
    }

    if (action === 'claim') {
      if (!isSupport(interaction.member, config, await categoryOf(ctx, ticket))) return void (await interaction.reply(ephemeral(ctx.t('tickets.noAccess'))));
      const claimed = await new TicketService(ctx).claim(ticket, interaction.user.id);
      await interaction.reply(ephemeral(claimed ? ctx.t('tickets.youClaimed') : ctx.t('tickets.takenBy', { user: `<@${ticket.claimedBy}>` })));
    }
  },
});

const ACTIVITY_THROTTLE_SEC = 300;

/** A message in a ticket moves its last activity — what auto-close looks at. Written at most every few minutes. */
export async function onMessage(ctx: BotModuleContext<TicketsConfig>, message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot) return;
  const ticketId = await ctx.redis.get(channelKey(message.channelId));
  if (!ticketId) return;
  const fresh = await ctx.redis.set(`tickets:activity:${ticketId}`, '1', 'EX', ACTIVITY_THROTTLE_SEC, 'NX');
  if (fresh) await ctx.db.ticket.updateMany({ where: { id: ticketId, status: 'open' }, data: { lastActivityAt: new Date() } });
}
