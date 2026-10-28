import { MessageTemplate } from '@bot/contracts';
import { defineCommand, type InteractionContext } from '@bot/core';
import { toGuildEntities } from '@bot/discord';
import {
  channelMention,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  roleMention,
  SlashCommandBuilder,
  type GuildBasedChannel,
  type SlashCommandStringOption,
} from 'discord.js';
import { MAX_SUBSCRIPTIONS, type NotificationsConfig, type SubscriptionDto } from './config.js';
import type { Provider, ProviderId } from './providers.js';
import { SubscriptionError, SubscriptionService } from './service.js';

type Ctx = InteractionContext<NotificationsConfig>;

const ICONS: Record<SubscriptionDto['provider'], string> = { youtube: '📺', twitch: '🟣', feed: '📰', webhook: '🪝' };
const label = (s: SubscriptionDto) => `${ICONS[s.provider]} ${s.source.name}`;

const subscriptionOption = (o: SlashCommandStringOption) =>
  o.setName('subscription').setDescription('Subscription').setRequired(true).setAutocomplete(true);

/** Whether the bot can post notifications to the channel. */
function canPost(channel: GuildBasedChannel): boolean {
  const me = channel.guild.members.me;
  return Boolean(me && channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]));
}

function problemText(ctx: Ctx, err: unknown): string | null {
  return err instanceof SubscriptionError ? ctx.t(`notifications.manage.errors.${err.problem}`, { max: MAX_SUBSCRIPTIONS }) : null;
}

export function notifyCommand(providers: () => Map<ProviderId, Provider>) {
  return defineCommand<NotificationsConfig>({
    data: new SlashCommandBuilder()
      .setName('notify')
      .setDescription('YouTube, Twitch and RSS notifications')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((s) => s.setName('list').setDescription('Show subscriptions'))
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Notify about new videos, streams or posts')
          .addStringOption((o) =>
            o
              .setName('platform')
              .setDescription('Where to watch')
              .setRequired(true)
              .addChoices({ name: 'YouTube', value: 'youtube' }, { name: 'Twitch', value: 'twitch' }, { name: 'RSS / Atom', value: 'feed' }),
          )
          .addStringOption((o) => o.setName('source').setDescription('Channel link, @handle, Twitch login or a feed or site link').setRequired(true).setMaxLength(500))
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Where to post').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          )
          .addRoleOption((o) => o.setName('role').setDescription('Role to mention'))
          .addStringOption((o) => o.setName('message').setDescription('Text: {channel.name}, {video.url}, {stream.url}, {item.url}…').setMaxLength(2000)),
      )
      .addSubcommand((s) =>
        s
          .setName('edit')
          .setDescription('Change a subscription')
          .addStringOption(subscriptionOption)
          .addChannelOption((o) => o.setName('channel').setDescription('Where to post').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
          .addRoleOption((o) => o.setName('role').setDescription('Role to mention'))
          .addBooleanOption((o) => o.setName('no-mention').setDescription('Mention nobody'))
          .addStringOption((o) => o.setName('message').setDescription('New text').setMaxLength(2000))
          .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled')),
      )
      .addSubcommand((s) => s.setName('remove').setDescription('Unsubscribe').addStringOption(subscriptionOption)),
    cooldownMs: 3_000,

    async autocomplete(interaction, ctx) {
      const query = interaction.options.getFocused().toLowerCase();
      const subscriptions = await new SubscriptionService(ctx, providers).list(interaction.guildId!);
      await interaction.respond(
        subscriptions
          .filter((s) => s.source.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((s) => ({ name: `${label(s)}${s.enabled ? '' : ' ⏸'}`.slice(0, 100), value: s.id })),
      );
    },

    async execute(interaction, ctx) {
      const guild = interaction.guild;
      if (!guild) return;
      const service = new SubscriptionService(ctx, providers);
      const sub = interaction.options.getSubcommand();
      const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } } as const;

      if (sub === 'list') {
        const subscriptions = await service.list(guild.id);
        // A subscription in trouble says why: its source cannot be checked or its last announcement was not posted.
        const problem = (s: SubscriptionDto) =>
          s.source.error
            ? ctx.t(`notifications.manage.sourceErrors.${s.source.error}`)
            : s.delivery.error
              ? ctx.t(`notifications.manage.deliveryErrors.${s.delivery.error}`)
              : null;
        const line = (s: SubscriptionDto) => {
          const text = `${s.enabled ? '🟢' : '⚪'} ${label(s)} → ${channelMention(s.channelId)}${s.mentionRoleId ? ` · ${roleMention(s.mentionRoleId)}` : ''}`;
          const why = s.enabled ? problem(s) : null;
          return why ? `${text}
  ⚠️ ${why}` : text;
        };
        const embed = new EmbedBuilder()
          .setTitle(ctx.t('notifications.name'))
          .setDescription(subscriptions.length > 0 ? subscriptions.map(line).join('\n') : ctx.t('notifications.manage.empty'))
          .setFooter({ text: ctx.t('notifications.manage.footer', { count: subscriptions.length, max: MAX_SUBSCRIPTIONS }) });
        await interaction.reply({ embeds: [embed], ...ephemeral });
        return;
      }

      const channel = interaction.options.getChannel('channel') as GuildBasedChannel | null;
      if (channel && !canPost(channel)) {
        await interaction.reply({ content: ctx.t('notifications.manage.noAccess', { channel: channelMention(channel.id) }), ...ephemeral });
        return;
      }
      const rawMessage = interaction.options.getString('message');
      const message = rawMessage ? MessageTemplate.parse({ content: rawMessage }) : undefined;

      // Looking a source up goes to YouTube, Twitch or a site and may take longer than 3 s.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const answer = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });
      try {
        if (sub === 'add') {
          const created = await service.create(
            guild.id,
            {
              provider: interaction.options.getString('platform', true) as ProviderId,
              query: interaction.options.getString('source', true).trim(),
              channelId: channel!.id,
              mentionRoleId: interaction.options.getRole('role')?.id ?? null,
              message,
            },
            toGuildEntities(guild),
          );
          await answer(ctx.t('notifications.manage.added', { source: label(created), channel: channelMention(created.channelId) }));
          return;
        }

        const id = interaction.options.getString('subscription', true);
        if (sub === 'remove') {
          const row = await service.find(guild.id, id);
          await service.remove(guild.id, id);
          await answer(ctx.t('notifications.manage.removed', { source: row.source.name }));
          return;
        }

        const role = interaction.options.getRole('role');
        const noMention = interaction.options.getBoolean('no-mention');
        const enabled = interaction.options.getBoolean('enabled');
        const updated = await service.update(
          guild.id,
          id,
          {
            ...(channel ? { channelId: channel.id } : {}),
            ...(role ? { mentionRoleId: role.id } : noMention ? { mentionRoleId: null } : {}),
            ...(message ? { message } : {}),
            ...(enabled !== null ? { enabled } : {}),
          },
          toGuildEntities(guild),
        );
        await answer(ctx.t('notifications.manage.updated', { source: label(updated) }));
      } catch (err) {
        const text = problemText(ctx, err);
        if (!text) throw err;
        await answer(text);
      }
    },
  });
}
