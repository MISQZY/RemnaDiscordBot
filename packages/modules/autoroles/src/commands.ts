import { defineCommand, type InteractionContext } from '@bot/core';
import { isElevatedRole, memberOutranksRole } from '@bot/discord';
import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  roleMention,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Role,
  type SlashCommandRoleOption,
  type SlashCommandStringOption,
} from 'discord.js';
import { PanelInput, type AutorolesConfig, type Panel } from './config.js';
import { toPanel } from './panel.js';
import { PanelService } from './panel-service.js';

type Ctx = InteractionContext<AutorolesConfig>;


const roleOption = (o: SlashCommandRoleOption) =>
  o.setName('role').setDescription('Role').setRequired(true);
const panelOption = (o: SlashCommandStringOption) =>
  o.setName('panel').setDescription('Role panel').setRequired(true).setAutocomplete(true);

const reply = (interaction: ChatInputCommandInteraction, content: string) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** Why the bot cannot assign the role, or why the invoker may not pick it; `null` — fine. */
function roleProblem(ctx: Ctx, interaction: ChatInputCommandInteraction, role: Role): string | null {
  if (role.id === role.guild.id) return ctx.t('autoroles.reply.everyone');
  if (role.managed) return ctx.t('autoroles.reply.managedRole', { role: role.name });
  if (isElevatedRole(role)) return ctx.t('core.roleElevated', { role: role.name });
  if (!role.editable) return ctx.t('autoroles.reply.higherRole', { role: role.name });
  if (!interaction.inCachedGuild() || !memberOutranksRole(interaction.member, role)) return ctx.t('core.roleAboveYou', { role: role.name });
  return null;
}

async function updateConfig(ctx: Ctx, interaction: ChatInputCommandInteraction, change: (config: AutorolesConfig) => AutorolesConfig) {
  const guildId = interaction.guildId!;
  const config = await ctx.getConfig(guildId);
  await ctx.config.update(guildId, 'autoroles', { config: change(structuredClone(config)) }, interaction.user.id);
}

function panelLabel(panel: Panel, channelName: string | undefined): string {
  const text = (panel.message.content ?? panel.message.embeds?.[0]?.title ?? '').replace(/\s+/g, ' ').slice(0, 50);
  return `#${channelName ?? panel.channelId} · ${text || panel.id} (${panel.items.length})`.slice(0, 100);
}

export const autorolesCommand = defineCommand<AutorolesConfig>({
  data: new SlashCommandBuilder()
    .setName('autoroles')
    .setDescription('Join roles, role restore and role panels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('list').setDescription('Show autoroles settings'))
    .addSubcommandGroup((g) =>
      g
        .setName('join')
        .setDescription('Roles given on join')
        .addSubcommand((s) => s.setName('add').setDescription('Give this role to new members').addRoleOption(roleOption))
        .addSubcommand((s) => s.setName('remove').setDescription('Stop giving this role on join').addRoleOption(roleOption))
        .addSubcommand((s) =>
          s
            .setName('delay')
            .setDescription('Delay before join roles are given')
            .addIntegerOption((o) =>
              o.setName('seconds').setDescription('0–3600').setRequired(true).setMinValue(0).setMaxValue(3600),
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('persistence')
        .setDescription('Restore roles when members come back')
        .addSubcommand((s) => s.setName('on').setDescription('Enable role restore'))
        .addSubcommand((s) => s.setName('off').setDescription('Disable role restore')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('panel')
        .setDescription('Self-assignable role panels')
        .addSubcommand((s) =>
          s
            .setName('create')
            .setDescription('Create a role panel')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Where to post the panel')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
            )
            .addRoleOption((o) => roleOption(o).setDescription('First role'))
            .addStringOption((o) =>
              o.setName('text').setDescription('Text above the buttons').setMaxLength(2000),
            )
            .addStringOption((o) =>
              o
                .setName('kind')
                .setDescription('Buttons or a dropdown')
                .addChoices(
                  { name: 'Buttons', value: 'buttons' },
                  { name: 'Dropdown', value: 'select' },
                ),
            )
            .addStringOption((o) =>
              o
                .setName('mode')
                .setDescription('How picking works')
                .addChoices(
                  { name: 'Toggle', value: 'toggle' },
                  { name: 'Only add', value: 'add' },
                  { name: 'Only remove', value: 'remove' },
                  { name: 'One of the panel', value: 'unique' },
                ),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('add-role')
            .setDescription('Add a role to a panel')
            .addStringOption(panelOption)
            .addRoleOption(roleOption)
            .addStringOption((o) => o.setName('label').setDescription('Button label').setMaxLength(80))
            .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setMaxLength(64)),
        )
        .addSubcommand((s) =>
          s.setName('remove-role').setDescription('Remove a role from a panel').addStringOption(panelOption).addRoleOption(roleOption),
        )
        .addSubcommand((s) =>
          s.setName('publish').setDescription('Post or update the panel message').addStringOption(panelOption),
        )
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a panel and its message').addStringOption(panelOption)),
    ),
  cooldownMs: 2_000,

  async autocomplete(interaction, ctx) {
    const query = interaction.options.getFocused().toLowerCase();
    const panels = await new PanelService(ctx.db, ctx.rest).list(interaction.guildId!);
    await interaction.respond(
      panels
        .map((p) => ({ name: panelLabel(p, interaction.guild?.channels.cache.get(p.channelId)?.name), value: p.id }))
        .filter((choice) => choice.name.toLowerCase().includes(query))
        .slice(0, 25),
    );
  },

  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const panels = new PanelService(ctx.db, ctx.rest);

    if (!group && sub === 'list') {
      const config = await ctx.getConfig(guildId);
      const list = await panels.list(guildId);
      const roles = (ids: string[]) => (ids.length > 0 ? ids.map(roleMention).join(' ') : ctx.t('autoroles.reply.none'));
      const embed = new EmbedBuilder()
        .setTitle(ctx.t('autoroles.name'))
        .addFields(
          { name: ctx.t('autoroles.reply.joinRoles'), value: `${roles(config.joinRoles.humans)}\n${ctx.t('autoroles.reply.delay', { seconds: config.joinRoles.delaySec })}` },
          { name: ctx.t('autoroles.reply.persistence'), value: ctx.t(config.persistence.enabled ? 'autoroles.reply.on' : 'autoroles.reply.off') },
          {
            name: ctx.t('autoroles.reply.panels'),
            value:
              list.map((p) => `${p.messageId ? '🟢' : '⚪'} ${panelLabel(p, interaction.guild?.channels.cache.get(p.channelId)?.name)}`).join('\n') ||
              ctx.t('autoroles.reply.none'),
          },
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }

    if (group === 'join') {
      if (sub === 'delay') {
        const seconds = interaction.options.getInteger('seconds', true);
        await updateConfig(ctx, interaction, (c) => ({ ...c, joinRoles: { ...c.joinRoles, delaySec: seconds } }));
        await reply(interaction, ctx.t('autoroles.reply.delaySet', { seconds }));
        return;
      }
      const role = interaction.options.getRole('role', true) as Role;
      if (sub === 'add') {
        const problem = roleProblem(ctx, interaction, role);
        if (problem) return void (await reply(interaction, problem));
        await updateConfig(ctx, interaction, (c) => ({ ...c, joinRoles: { ...c.joinRoles, humans: [...new Set([...c.joinRoles.humans, role.id])].slice(0, 10) } }));
        await reply(interaction, ctx.t('autoroles.reply.joinAdded', { role: role.name }));
      } else {
        await updateConfig(ctx, interaction, (c) => ({ ...c, joinRoles: { ...c.joinRoles, humans: c.joinRoles.humans.filter((id) => id !== role.id) } }));
        await reply(interaction, ctx.t('autoroles.reply.joinRemoved', { role: role.name }));
      }
      return;
    }

    if (group === 'persistence') {
      const enabled = sub === 'on';
      await updateConfig(ctx, interaction, (c) => ({ ...c, persistence: { ...c.persistence, enabled } }));
      await reply(interaction, ctx.t(enabled ? 'autoroles.reply.persistenceOn' : 'autoroles.reply.persistenceOff'));
      return;
    }

    // Panels
    if (sub === 'create') {
      const role = interaction.options.getRole('role', true) as Role;
      const problem = roleProblem(ctx, interaction, role);
      if (problem) return void (await reply(interaction, problem));
      const input = PanelInput.parse({
        channelId: interaction.options.getChannel('channel', true).id,
        kind: interaction.options.getString('kind') ?? 'buttons',
        mode: interaction.options.getString('mode') ?? 'toggle',
        message: { content: interaction.options.getString('text') ?? ctx.tGuild('autoroles.reply.defaultText') },
        items: [{ roleId: role.id, label: role.name.slice(0, 80) }],
      });
      await panels.create(guildId, input);
      await reply(interaction, ctx.t('autoroles.reply.panelCreated'));
      return;
    }

    const panelId = interaction.options.getString('panel', true);
    const row = await panels.find(guildId, panelId).catch(() => null);
    if (!row) return void (await reply(interaction, ctx.t('autoroles.panelMissing')));
    const panel = toPanel(row);
    const asInput = (patch: Partial<PanelInput>): PanelInput => PanelInput.parse({ ...panel, ...patch });

    switch (sub) {
      case 'add-role': {
        const role = interaction.options.getRole('role', true) as Role;
        const problem = roleProblem(ctx, interaction, role);
        if (problem) return void (await reply(interaction, problem));
        if (panel.items.some((i) => i.roleId === role.id)) return void (await reply(interaction, ctx.t('autoroles.reply.alreadyInPanel')));
        if (panel.items.length >= 25) return void (await reply(interaction, ctx.t('autoroles.reply.panelFull')));
        const emoji = interaction.options.getString('emoji') ?? undefined;
        await panels.update(guildId, panelId, asInput({
          items: [...panel.items, { roleId: role.id, label: (interaction.options.getString('label') ?? role.name).slice(0, 80), emoji, style: 'secondary' }],
        }));
        await reply(interaction, ctx.t('autoroles.reply.roleAdded', { role: role.name }));
        return;
      }
      case 'remove-role': {
        const role = interaction.options.getRole('role', true);
        const items = panel.items.filter((i) => i.roleId !== role.id);
        if (items.length === 0) return void (await reply(interaction, ctx.t('autoroles.reply.lastRole')));
        await panels.update(guildId, panelId, asInput({ items }));
        await reply(interaction, ctx.t('autoroles.reply.roleRemoved', { role: role.name }));
        return;
      }
      case 'publish': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const published = await panels.publish(guildId, panelId);
        await interaction.editReply(ctx.t('autoroles.reply.published', { channel: `<#${published.channelId}>` }));
        return;
      }
      case 'delete':
        await panels.delete(guildId, panelId);
        await reply(interaction, ctx.t('autoroles.reply.panelDeleted'));
        return;
    }
  },
});
