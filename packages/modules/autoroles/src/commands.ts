import { defineCommand, type InteractionContext } from '@bot/core';
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

const ru = (text: string) => ({ ru: text });

const roleOption = (o: SlashCommandRoleOption) =>
  o.setName('role').setNameLocalizations(ru('роль')).setDescription('Role').setDescriptionLocalizations(ru('Роль')).setRequired(true);
const panelOption = (o: SlashCommandStringOption) =>
  o.setName('panel').setNameLocalizations(ru('панель')).setDescription('Role panel').setDescriptionLocalizations(ru('Панель ролей')).setRequired(true).setAutocomplete(true);

const reply = (interaction: ChatInputCommandInteraction, content: string) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** Причина, по которой бот не может выдавать роль, или `null`. */
function roleProblem(ctx: Ctx, role: Role): string | null {
  if (role.id === role.guild.id) return ctx.t('autoroles.commands.everyone');
  if (role.managed) return ctx.t('autoroles.commands.managedRole', { role: role.name });
  if (!role.editable) return ctx.t('autoroles.commands.higherRole', { role: role.name });
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
    .setDescriptionLocalizations(ru('Роли при входе, восстановление ролей и панели ролей'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('list').setDescription('Show autoroles settings').setDescriptionLocalizations(ru('Показать настройки авторолей')))
    .addSubcommandGroup((g) =>
      g
        .setName('join')
        .setDescription('Roles given on join')
        .setDescriptionLocalizations(ru('Роли при входе'))
        .addSubcommand((s) => s.setName('add').setDescription('Give this role to new members').setDescriptionLocalizations(ru('Выдавать роль новым участникам')).addRoleOption(roleOption))
        .addSubcommand((s) => s.setName('remove').setDescription('Stop giving this role on join').setDescriptionLocalizations(ru('Перестать выдавать роль при входе')).addRoleOption(roleOption))
        .addSubcommand((s) =>
          s
            .setName('delay')
            .setDescription('Delay before join roles are given')
            .setDescriptionLocalizations(ru('Задержка перед выдачей ролей при входе'))
            .addIntegerOption((o) =>
              o.setName('seconds').setNameLocalizations(ru('секунды')).setDescription('0–3600').setRequired(true).setMinValue(0).setMaxValue(3600),
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('persistence')
        .setDescription('Restore roles when members come back')
        .setDescriptionLocalizations(ru('Восстанавливать роли вернувшимся участникам'))
        .addSubcommand((s) => s.setName('on').setDescription('Enable role restore').setDescriptionLocalizations(ru('Включить восстановление ролей')))
        .addSubcommand((s) => s.setName('off').setDescription('Disable role restore').setDescriptionLocalizations(ru('Выключить восстановление ролей'))),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('panel')
        .setDescription('Self-assignable role panels')
        .setDescriptionLocalizations(ru('Панели самостоятельного выбора ролей'))
        .addSubcommand((s) =>
          s
            .setName('create')
            .setDescription('Create a role panel')
            .setDescriptionLocalizations(ru('Создать панель ролей'))
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setNameLocalizations(ru('канал'))
                .setDescription('Where to post the panel')
                .setDescriptionLocalizations(ru('Куда отправить панель'))
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
            )
            .addRoleOption((o) => roleOption(o).setDescription('First role').setDescriptionLocalizations(ru('Первая роль')))
            .addStringOption((o) =>
              o.setName('text').setNameLocalizations(ru('текст')).setDescription('Text above the buttons').setDescriptionLocalizations(ru('Текст над кнопками')).setMaxLength(2000),
            )
            .addStringOption((o) =>
              o
                .setName('kind')
                .setNameLocalizations(ru('вид'))
                .setDescription('Buttons or a dropdown')
                .setDescriptionLocalizations(ru('Кнопки или выпадающий список'))
                .addChoices(
                  { name: 'Buttons', name_localizations: ru('Кнопки'), value: 'buttons' },
                  { name: 'Dropdown', name_localizations: ru('Выпадающий список'), value: 'select' },
                ),
            )
            .addStringOption((o) =>
              o
                .setName('mode')
                .setNameLocalizations(ru('режим'))
                .setDescription('How picking works')
                .setDescriptionLocalizations(ru('Как работает выбор'))
                .addChoices(
                  { name: 'Toggle', name_localizations: ru('Выдать или снять'), value: 'toggle' },
                  { name: 'Only add', name_localizations: ru('Только выдать'), value: 'add' },
                  { name: 'Only remove', name_localizations: ru('Только снять'), value: 'remove' },
                  { name: 'One of the panel', name_localizations: ru('Одна из панели'), value: 'unique' },
                ),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('add-role')
            .setDescription('Add a role to a panel')
            .setDescriptionLocalizations(ru('Добавить роль в панель'))
            .addStringOption(panelOption)
            .addRoleOption(roleOption)
            .addStringOption((o) => o.setName('label').setNameLocalizations(ru('подпись')).setDescription('Button label').setDescriptionLocalizations(ru('Подпись кнопки')).setMaxLength(80))
            .addStringOption((o) => o.setName('emoji').setNameLocalizations(ru('эмодзи')).setDescription('Emoji').setDescriptionLocalizations(ru('Эмодзи')).setMaxLength(64)),
        )
        .addSubcommand((s) =>
          s.setName('remove-role').setDescription('Remove a role from a panel').setDescriptionLocalizations(ru('Убрать роль из панели')).addStringOption(panelOption).addRoleOption(roleOption),
        )
        .addSubcommand((s) =>
          s.setName('publish').setDescription('Post or update the panel message').setDescriptionLocalizations(ru('Отправить или обновить сообщение панели')).addStringOption(panelOption),
        )
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a panel and its message').setDescriptionLocalizations(ru('Удалить панель и её сообщение')).addStringOption(panelOption)),
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
      const roles = (ids: string[]) => (ids.length > 0 ? ids.map(roleMention).join(' ') : ctx.t('autoroles.commands.none'));
      const embed = new EmbedBuilder()
        .setTitle(ctx.t('autoroles.name'))
        .addFields(
          { name: ctx.t('autoroles.commands.joinRoles'), value: `${roles(config.joinRoles.humans)}\n${ctx.t('autoroles.commands.delay', { seconds: config.joinRoles.delaySec })}` },
          { name: ctx.t('autoroles.commands.persistence'), value: ctx.t(config.persistence.enabled ? 'autoroles.commands.on' : 'autoroles.commands.off') },
          {
            name: ctx.t('autoroles.commands.panels'),
            value:
              list.map((p) => `${p.messageId ? '🟢' : '⚪'} ${panelLabel(p, interaction.guild?.channels.cache.get(p.channelId)?.name)}`).join('\n') ||
              ctx.t('autoroles.commands.none'),
          },
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }

    if (group === 'join') {
      if (sub === 'delay') {
        const seconds = interaction.options.getInteger('seconds', true);
        await updateConfig(ctx, interaction, (c) => ({ ...c, joinRoles: { ...c.joinRoles, delaySec: seconds } }));
        await reply(interaction, ctx.t('autoroles.commands.delaySet', { seconds }));
        return;
      }
      const role = interaction.options.getRole('role', true) as Role;
      if (sub === 'add') {
        const problem = roleProblem(ctx, role);
        if (problem) return void (await reply(interaction, problem));
        await updateConfig(ctx, interaction, (c) => ({ ...c, joinRoles: { ...c.joinRoles, humans: [...new Set([...c.joinRoles.humans, role.id])].slice(0, 10) } }));
        await reply(interaction, ctx.t('autoroles.commands.joinAdded', { role: role.name }));
      } else {
        await updateConfig(ctx, interaction, (c) => ({ ...c, joinRoles: { ...c.joinRoles, humans: c.joinRoles.humans.filter((id) => id !== role.id) } }));
        await reply(interaction, ctx.t('autoroles.commands.joinRemoved', { role: role.name }));
      }
      return;
    }

    if (group === 'persistence') {
      const enabled = sub === 'on';
      await updateConfig(ctx, interaction, (c) => ({ ...c, persistence: { ...c.persistence, enabled } }));
      await reply(interaction, ctx.t(enabled ? 'autoroles.commands.persistenceOn' : 'autoroles.commands.persistenceOff'));
      return;
    }

    // Панели
    if (sub === 'create') {
      const role = interaction.options.getRole('role', true) as Role;
      const problem = roleProblem(ctx, role);
      if (problem) return void (await reply(interaction, problem));
      const input = PanelInput.parse({
        channelId: interaction.options.getChannel('channel', true).id,
        kind: interaction.options.getString('kind') ?? 'buttons',
        mode: interaction.options.getString('mode') ?? 'toggle',
        message: { content: interaction.options.getString('text') ?? ctx.t('autoroles.commands.defaultText') },
        items: [{ roleId: role.id, label: role.name.slice(0, 80) }],
      });
      await panels.create(guildId, input);
      await reply(interaction, ctx.t('autoroles.commands.panelCreated'));
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
        const problem = roleProblem(ctx, role);
        if (problem) return void (await reply(interaction, problem));
        if (panel.items.some((i) => i.roleId === role.id)) return void (await reply(interaction, ctx.t('autoroles.commands.alreadyInPanel')));
        if (panel.items.length >= 25) return void (await reply(interaction, ctx.t('autoroles.commands.panelFull')));
        const emoji = interaction.options.getString('emoji') ?? undefined;
        await panels.update(guildId, panelId, asInput({
          items: [...panel.items, { roleId: role.id, label: (interaction.options.getString('label') ?? role.name).slice(0, 80), emoji, style: 'secondary' }],
        }));
        await reply(interaction, ctx.t('autoroles.commands.roleAdded', { role: role.name }));
        return;
      }
      case 'remove-role': {
        const role = interaction.options.getRole('role', true);
        const items = panel.items.filter((i) => i.roleId !== role.id);
        if (items.length === 0) return void (await reply(interaction, ctx.t('autoroles.commands.lastRole')));
        await panels.update(guildId, panelId, asInput({ items }));
        await reply(interaction, ctx.t('autoroles.commands.roleRemoved', { role: role.name }));
        return;
      }
      case 'publish': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const published = await panels.publish(guildId, panelId);
        await interaction.editReply(ctx.t('autoroles.commands.published', { channel: `<#${published.channelId}>` }));
        return;
      }
      case 'delete':
        await panels.delete(guildId, panelId);
        await reply(interaction, ctx.t('autoroles.commands.panelDeleted'));
        return;
    }
  },
});
