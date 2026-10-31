import { defineCommand, defineComponent, ephemeralReply as reply, type InteractionContext } from '@bot/core';
import { toGuildEntities as entities } from '@bot/discord';
import {
  EmbedBuilder,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type SlashCommandStringOption,
} from 'discord.js';
import { z } from 'zod';
import { forgetTriggers } from './bot.js';
import { CommandInput, MatchMode, MAX_COMMANDS, toDto, type CommandDto, type CustomCommandsConfig } from './config.js';
import { CommandError, CustomCommandService } from './service.js';

type Ctx = InteractionContext<CustomCommandsConfig>;

/** customIds: `cc:add:<pending id>` and `cc:edit:<command id>`. */
export const COMPONENT_PREFIX = 'cc';
const RESPONSE_INPUT = 'response';
const EXTRA_INPUT = 'extra';
const PENDING_TTL_SEC = 15 * 60;
/** Placeholders shown as hints; the full list is in the template docs. */
const PLACEHOLDER_HINT = '{user.mention} {user.name} {guild.name}';
const pendingKey = (id: string) => `custom-commands:pending:${id}`;

/** What `/cc add` collected before the modal asks for the response. */
const Pending = z.object({
  guildId: z.string(),
  userId: z.string(),
  input: z.object({
    name: z.string(),
    kind: z.enum(['slash', 'trigger']),
    description: z.string().nullable(),
    matchMode: MatchMode.nullable(),
    pattern: z.string().nullable(),
    ephemeral: z.boolean(),
  }),
});

const commandOption = (o: SlashCommandStringOption) =>
  o.setName('command').setDescription('Custom command').setRequired(true).setAutocomplete(true);

const label = (command: Pick<CommandDto, 'kind' | 'name' | 'pattern'>) =>
  command.kind === 'slash' ? `/${command.name}` : `${command.name} · ${command.pattern ?? ''}`;

/** A localized reason why the change was refused. */
function problemText(ctx: Ctx, err: unknown): string | null {
  if (err instanceof CommandError) return ctx.t(`custom-commands.manage.errors.${err.problem}`, { max: MAX_COMMANDS });
  if (err instanceof z.ZodError) return ctx.t('custom-commands.manage.errors.invalid', { error: err.issues[0]?.message ?? '' });
  return null;
}

function responseModal(ctx: Ctx, customId: string, kind: CommandDto['kind'], values: { response?: string; extra?: string | null }) {
  const response = new TextInputBuilder().setCustomId(RESPONSE_INPUT).setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true);
  if (values.response?.trim()) response.setValue(values.response);
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(ctx.t('custom-commands.manage.modalTitle').slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(ctx.t('custom-commands.manage.responseLabel'))
        .setDescription(ctx.t('custom-commands.manage.responseHint', { placeholders: PLACEHOLDER_HINT, args: '{args}' }).slice(0, 100))
        .setTextInputComponent(response),
    );
  if (values.extra !== undefined) {
    const slash = kind === 'slash';
    const extra = new TextInputBuilder()
      .setCustomId(EXTRA_INPUT)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(slash ? 100 : 200)
      .setRequired(!slash);
    if (values.extra) extra.setValue(values.extra);
    modal.addLabelComponents(
      new LabelBuilder().setLabel(ctx.t(slash ? 'custom-commands.manage.descriptionLabel' : 'custom-commands.manage.patternLabel')).setTextInputComponent(extra),
    );
  }
  return modal;
}

export const cc = defineCommand<CustomCommandsConfig>({
  data: new SlashCommandBuilder()
    .setName('cc')
    .setDescription('Manage custom commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('list').setDescription('Show custom commands'))
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create a command; the response is asked next')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Slash command or auto-reply')
            .setRequired(true)
            .addChoices({ name: 'Slash command', value: 'slash' }, { name: 'Auto-reply', value: 'trigger' }),
        )
        .addStringOption((o) => o.setName('name').setDescription('Name: for slash commands lowercase, up to 32').setRequired(true).setMaxLength(50))
        .addStringOption((o) =>
          o
            .setName('match')
            .setDescription('Auto-reply: how the message must match')
            .addChoices(
              { name: 'Exact', value: 'exact' },
              { name: 'Starts with', value: 'startsWith' },
              { name: 'Contains', value: 'contains' },
              { name: 'Regular expression', value: 'regex' },
            ),
        )
        .addStringOption((o) => o.setName('pattern').setDescription('Auto-reply: text to look for').setMaxLength(200))
        .addStringOption((o) => o.setName('description').setDescription('Slash command: description in the menu').setMaxLength(100))
        .addBooleanOption((o) => o.setName('ephemeral').setDescription('Slash command: only the caller sees the reply')),
    )
    .addSubcommand((s) => s.setName('edit').setDescription('Change the response').addStringOption(commandOption))
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Turn a command on or off')
        .addStringOption(commandOption)
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a command').addStringOption(commandOption)),
  cooldownMs: 2_000,

  async autocomplete(interaction, ctx) {
    const query = interaction.options.getFocused().toLowerCase();
    const commands = await new CustomCommandService(ctx).list(interaction.guildId!);
    await interaction.respond(
      commands
        .filter((c) => label(c).toLowerCase().includes(query))
        .slice(0, 25)
        .map((c) => ({ name: `${c.enabled ? '' : '⏸ '}${label(c)}`.slice(0, 100), value: c.id })),
    );
  },

  async execute(interaction, ctx) {
    const guild = interaction.guild;
    if (!guild) return;
    const service = new CustomCommandService(ctx);
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const commands = await service.list(guild.id);
      const line = (c: CommandDto) => `${c.enabled ? '🟢' : '⚪'} \`${label(c).slice(0, 60)}\` · ${ctx.t('custom-commands.manage.uses', { count: c.uses })}`;
      const embed = new EmbedBuilder()
        .setTitle(ctx.t('custom-commands.name'))
        .setDescription(commands.length > 0 ? commands.map(line).join('\n').slice(0, 4000) : ctx.t('custom-commands.manage.empty'))
        .setFooter({ text: ctx.t('custom-commands.manage.footer', { count: commands.length, max: MAX_COMMANDS }) });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'add') {
      const kind = interaction.options.getString('type', true) as CommandDto['kind'];
      const trigger = kind === 'trigger';
      const input = {
        name: interaction.options.getString('name', true).trim(),
        kind,
        description: trigger ? null : interaction.options.getString('description'),
        matchMode: trigger ? ((interaction.options.getString('match') ?? 'exact') as MatchMode) : null,
        pattern: trigger ? (interaction.options.getString('pattern') ?? interaction.options.getString('name', true)).trim() : null,
        ephemeral: !trigger && (interaction.options.getBoolean('ephemeral') ?? false),
      };
      // Catch a bad name or pattern now rather than after the response is typed.
      const check = CommandInput.safeParse({ ...input, response: { content: '-' } });
      if (!check.success) return void (await reply(interaction, problemText(ctx, check.error)!));

      await ctx.redis.set(pendingKey(interaction.id), JSON.stringify({ guildId: guild.id, userId: interaction.user.id, input }), 'EX', PENDING_TTL_SEC);
      await interaction.showModal(responseModal(ctx, `${COMPONENT_PREFIX}:add:${interaction.id}`, kind, {}));
      return;
    }

    const id = interaction.options.getString('command', true);
    let row;
    try {
      row = toDto(await service.find(guild.id, id));
    } catch (err) {
      return void (await reply(interaction, problemText(ctx, err) ?? ctx.t('custom-commands.manage.errors.notFound')));
    }

    if (sub === 'edit') {
      const extra = row.kind === 'slash' ? (row.description ?? '') : (row.pattern ?? '');
      await interaction.showModal(responseModal(ctx, `${COMPONENT_PREFIX}:edit:${row.id}`, row.kind, { response: row.response.content, extra }));
      return;
    }

    try {
      if (sub === 'toggle') {
        const enabled = interaction.options.getBoolean('enabled', true);
        await service.update(guild.id, row.id, CommandInput.parse({ ...row, enabled }), entities(guild));
        await reply(interaction, ctx.t(enabled ? 'custom-commands.manage.enabled' : 'custom-commands.manage.disabled', { command: label(row) }));
      } else {
        await service.remove(guild.id, row.id);
        await reply(interaction, ctx.t('custom-commands.manage.deleted', { command: label(row) }));
      }
      forgetTriggers(guild.id);
    } catch (err) {
      const text = problemText(ctx, err);
      if (!text) throw err;
      await reply(interaction, text);
    }
  },
});

/** Modal of `/cc add` and `/cc edit`: saves the response (embeds of an existing response are kept). */
export const responseModalHandler = defineComponent<CustomCommandsConfig>({
  async handle(interaction, ctx) {
    if (!interaction.isModalSubmit() || !interaction.guild) return;
    const guild = interaction.guild;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return void (await reply(interaction, ctx.t('custom-commands.notAllowed')));
    const [, action, id] = interaction.customId.split(':');
    const content = interaction.fields.getTextInputValue(RESPONSE_INPUT).trim();
    const extra = interaction.fields.fields.has(EXTRA_INPUT) ? interaction.fields.getTextInputValue(EXTRA_INPUT).trim() : undefined;
    const service = new CustomCommandService(ctx);

    try {
      if (action === 'add') {
        const raw = await ctx.redis.getdel(pendingKey(id!));
        const pending = raw ? Pending.safeParse(JSON.parse(raw)) : null;
        if (!pending?.success || pending.data.guildId !== guild.id) return void (await reply(interaction, ctx.t('custom-commands.manage.expired')));
        const input = CommandInput.parse({ ...pending.data.input, response: { content } });
        const created = await service.create(guild.id, input, interaction.user.id, entities(guild));
        forgetTriggers(guild.id);
        await reply(interaction, ctx.t('custom-commands.manage.created', { command: label(created) }));
        return;
      }

      const row = toDto(await service.find(guild.id, id!));
      const input = CommandInput.parse({
        ...row,
        response: { ...row.response, content },
        ...(extra === undefined ? {} : row.kind === 'slash' ? { description: extra || null } : { pattern: extra }),
      });
      const updated = await service.update(guild.id, row.id, input, entities(guild));
      forgetTriggers(guild.id);
      await reply(interaction, ctx.t('custom-commands.manage.updated', { command: label(updated) }));
    } catch (err) {
      const text = problemText(ctx, err);
      if (!text) throw err;
      await reply(interaction, text);
    }
  },
});
