import { MessageTemplate } from '@bot/contracts';
import { defineCommand, ephemeralReply as reply, type ComponentHandler, type InteractionContext } from '@bot/core';
import { memberTemplateVars } from '@bot/discord';
import { renderMessage } from '@bot/templates';
import {
  ChannelType,
  channelMention,
  EmbedBuilder,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
  type SlashCommandStringOption,
} from 'discord.js';
import { WelcomeKind, type WelcomeConfig } from '../config.js';
import { greet } from '../greet.js';

type Ctx = InteractionContext<WelcomeConfig>;

/** customId of the message editor modal: `welcome:message:<kind>`. */
export const MODAL_PREFIX = 'welcome';
const TEXT_INPUT_ID = 'content';
const KINDS: WelcomeKind[] = ['join', 'leave', 'dm'];

/** Placeholders shown as hints; the full list is in the template docs. */
const PLACEHOLDER_HINT = '{user.mention} {user.name} {guild.name} {guild.memberCount}';

/** Where each kind lives in the config. */
const settingsKey = (kind: WelcomeKind) => (kind === 'dm' ? 'joinDm' : kind);
const defaultsKey = (kind: WelcomeKind) => `welcome.defaults.${kind}`;

const kindOption = (kinds: WelcomeKind[]) => (o: SlashCommandStringOption) =>
  o
    .setName('kind')
    .setDescription('Which message')
    .setRequired(true)
    .addChoices(...kinds.map((kind) => ({ name: { join: 'Join', leave: 'Leave', dm: 'Direct message' }[kind], value: kind })));

async function updateConfig(ctx: Ctx, guildId: string, userId: string, change: (config: WelcomeConfig) => void): Promise<void> {
  const config = structuredClone(await ctx.getConfig(guildId));
  change(config);
  await ctx.config.update(guildId, 'welcome', { config }, userId);
}

const preview = (text: string | undefined, max = 300) => {
  const line = (text ?? '').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

function optionsText(config: WelcomeConfig, ctx: Ctx): string {
  const onOff = (value: boolean) => ctx.t(value ? 'welcome.show.on' : 'welcome.show.off');
  return [
    ctx.t('welcome.show.ignoreBots', { state: onOff(config.ignoreBots) }),
    ctx.t('welcome.show.waitForScreening', { state: onOff(config.waitForScreening) }),
  ].join('\n');
}

function showSettings(config: WelcomeConfig, ctx: Ctx): EmbedBuilder {
  const field = (kind: WelcomeKind) => {
    const settings = config[settingsKey(kind)];
    const channelId = kind === 'dm' ? null : (settings as WelcomeConfig['join']).channelId;
    const target =
      kind === 'dm'
        ? ctx.t('welcome.show.dmTarget')
        : channelId
          ? ctx.t('welcome.show.channel', { channel: channelMention(channelId) })
          : ctx.t('welcome.show.channelMissing');
    const broken = settings.enabled && kind !== 'dm' && !channelId;
    const status = broken ? '⚠️' : settings.enabled ? '🟢' : '⚪';
    const text = preview(settings.message.content) || ctx.t('welcome.show.embedOnly');
    return { name: `${status} ${ctx.t(`welcome.kind.${kind}`)}`, value: `${target}\n>>> ${text}`.slice(0, 1024) };
  };
  return new EmbedBuilder()
    .setTitle(ctx.t('welcome.show.title'))
    .addFields(KINDS.map(field))
    .addFields({ name: ctx.t('welcome.show.options'), value: optionsText(config, ctx) })
    .setFooter({ text: ctx.t('welcome.show.footer', { placeholders: PLACEHOLDER_HINT }) });
}

function messageModal(kind: WelcomeKind, current: string | undefined, ctx: Ctx): ModalBuilder {
  const input = new TextInputBuilder().setCustomId(TEXT_INPUT_ID).setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true);
  if (current?.trim()) input.setValue(current);
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}:message:${kind}`)
    .setTitle(ctx.t('welcome.modal.title', { kind: ctx.t(`welcome.kind.${kind}`) }).slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(ctx.t('welcome.modal.label'))
        .setDescription(ctx.t('welcome.modal.hint', { placeholders: PLACEHOLDER_HINT }).slice(0, 100))
        .setTextInputComponent(input),
    );
}

/** Saves the text from the message editor modal; embeds of the message are kept. */
export const messageModalHandler: ComponentHandler<WelcomeConfig> = {
  async handle(interaction, ctx) {
    if (!interaction.isModalSubmit() || !interaction.guildId) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await reply(interaction, ctx.t('welcome.reply.forbidden'));
      return;
    }
    const kind = WelcomeKind.safeParse(interaction.customId.split(':')[2]);
    if (!kind.success) return;

    const content = interaction.fields.getTextInputValue(TEXT_INPUT_ID).trim();
    const config = await ctx.getConfig(interaction.guildId);
    const message = MessageTemplate.safeParse({ ...config[settingsKey(kind.data)].message, content });
    if (!message.success || !content) {
      await reply(interaction, ctx.t('welcome.reply.empty'));
      return;
    }
    await updateConfig(ctx, interaction.guildId, interaction.user.id, (c) => {
      c[settingsKey(kind.data)].message = message.data;
    });

    const rendered = renderMessage(message.data, memberTemplateVars(interaction.member as GuildMember)).content ?? '';
    await reply(interaction, `${ctx.t('welcome.reply.saved', { kind: ctx.t(`welcome.kind.${kind.data}`) })}\n>>> ${rendered}`.slice(0, 2000));
  },
};

export const welcomeCommand = defineCommand<WelcomeConfig>({
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Welcome messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub.setName('show').setDescription('Show welcome settings'))
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Set the channel for welcome or farewell messages')
        .addStringOption(kindOption(['join', 'leave']))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Text channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) => sub.setName('message').setDescription('Edit the message text').addStringOption(kindOption(KINDS)))
    .addSubcommand((sub) => sub.setName('enable').setDescription('Turn a message on').addStringOption(kindOption(KINDS)))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Turn a message off').addStringOption(kindOption(KINDS)))
    .addSubcommand((sub) => sub.setName('reset').setDescription('Restore the default text').addStringOption(kindOption(KINDS)))
    .addSubcommand((sub) => sub.setName('test').setDescription('Send a test message as if you just joined or left').addStringOption(kindOption(KINDS)))
    .addSubcommand((sub) =>
      sub
        .setName('options')
        .setDescription('Bots and Membership Screening')
        .addBooleanOption((o) => o.setName('ignore-bots').setDescription('Do not greet bots'))
        .addBooleanOption((o) => o.setName('wait-for-screening').setDescription('Greet after the server rules are accepted')),
    ),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();

    if (sub === 'show') {
      await interaction.reply({ embeds: [showSettings(await ctx.getConfig(guildId), ctx)], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'options') {
      const ignoreBots = interaction.options.getBoolean('ignore-bots');
      const waitForScreening = interaction.options.getBoolean('wait-for-screening');
      await updateConfig(ctx, guildId, interaction.user.id, (c) => {
        if (ignoreBots !== null) c.ignoreBots = ignoreBots;
        if (waitForScreening !== null) c.waitForScreening = waitForScreening;
      });
      const config = await ctx.getConfig(guildId);
      await reply(interaction, optionsText(config, ctx));
      return;
    }

    const kind = WelcomeKind.parse(interaction.options.getString('kind', true));
    const kindName = ctx.t(`welcome.kind.${kind}`);

    switch (sub) {
      case 'channel': {
        const channel = interaction.options.getChannel('channel', true) as GuildTextBasedChannel;
        const me = interaction.guild?.members.me;
        if (me && !channel.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          await reply(interaction, ctx.t('welcome.reply.noAccess', { channel: channelMention(channel.id) }));
          return;
        }
        await updateConfig(ctx, guildId, interaction.user.id, (c) => {
          const settings = c[kind === 'leave' ? 'leave' : 'join'];
          settings.channelId = channel.id;
          settings.enabled = true;
        });
        await reply(interaction, ctx.t('welcome.reply.channelSet', { kind: kindName, channel: channelMention(channel.id) }));
        return;
      }
      case 'message': {
        const config = await ctx.getConfig(guildId);
        await interaction.showModal(messageModal(kind, config[settingsKey(kind)].message.content, ctx));
        return;
      }
      case 'enable':
      case 'disable': {
        const enabled = sub === 'enable';
        const config = await ctx.getConfig(guildId);
        if (enabled && kind !== 'dm' && !config[kind].channelId) {
          await reply(interaction, ctx.t('welcome.reply.noChannel', { kind: kindName }));
          return;
        }
        await updateConfig(ctx, guildId, interaction.user.id, (c) => {
          c[settingsKey(kind)].enabled = enabled;
        });
        await reply(interaction, ctx.t(enabled ? 'welcome.reply.enabled' : 'welcome.reply.disabled', { kind: kindName }));
        return;
      }
      case 'reset': {
        const content = ctx.i18n.raw(ctx.guildLocale, defaultsKey(kind));
        await updateConfig(ctx, guildId, interaction.user.id, (c) => {
          c[settingsKey(kind)].message = { content };
        });
        await reply(interaction, ctx.t('welcome.reply.reset', { kind: kindName }));
        return;
      }
      case 'test': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const config = await ctx.getConfig(guildId);
        const sent = await greet(kind, interaction.member as GuildMember, config, ctx.logger, { force: true });
        await interaction.editReply(ctx.t(sent ? 'welcome.test.sent' : 'welcome.test.notSent'));
        return;
      }
    }
  },
});
