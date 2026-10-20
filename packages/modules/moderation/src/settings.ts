import { defineCommand, type InteractionContext } from '@bot/core';
import {
  channelMention,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
} from 'discord.js';
import type { z } from 'zod';
import { ModerationConfig, type EscalationRule } from './config.js';
import { formatDuration, MAX_TIMEOUT_SEC, parseDuration } from './duration.js';

type Ctx = InteractionContext<ModerationConfig>;
type Rule = z.infer<typeof EscalationRule>;

const reply = (interaction: ChatInputCommandInteraction, content: string) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** Saves a changed config; false — the change breaks the schema (the reply is already sent). */
async function updateConfig(ctx: Ctx, interaction: ChatInputCommandInteraction, change: (config: ModerationConfig) => ModerationConfig) {
  const guildId = interaction.guildId!;
  const next = ModerationConfig.safeParse(change(structuredClone(await ctx.getConfig(guildId))));
  if (!next.success) {
    await reply(interaction, ctx.t('moderation.settings.invalid', { error: next.error.issues[0]?.message ?? '' }));
    return false;
  }
  await ctx.config.update(guildId, ctx.moduleId, { config: next.data }, interaction.user.id);
  return true;
}

export function describeRule(ctx: Pick<Ctx, 't' | 'locale'>, rule: Rule): string {
  const action = ctx.t(`moderation.actions.${rule.action}`);
  const duration = rule.durationSec ? ` · ${formatDuration(rule.durationSec, ctx.locale)}` : '';
  return ctx.t('moderation.settings.rule', { warns: rule.warns, action: `${action}${duration}` });
}

export const modsettings = defineCommand<ModerationConfig>({
  data: new SlashCommandBuilder()
    .setName('modsettings')
    .setDescription('Configure moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('show').setDescription('Show moderation settings'))
    .addSubcommand((s) =>
      s
        .setName('log-channel')
        .setDescription('Channel for the case log; empty — no log')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) =>
      s
        .setName('dm')
        .setDescription('DM members about their punishments')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Send DMs').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('require-reason')
        .setDescription('Make the reason mandatory')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Reason is required').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('warn-expiry')
        .setDescription('After how many days warnings stop counting')
        .addIntegerOption((o) => o.setName('days').setDescription('Days; 0 — never').setRequired(true).setMinValue(0).setMaxValue(365)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('escalation')
        .setDescription('Automatic punishments for warnings')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Punish automatically at a number of warnings')
            .addIntegerOption((o) => o.setName('warns').setDescription('Active warnings').setRequired(true).setMinValue(1).setMaxValue(50))
            .addStringOption((o) =>
              o
                .setName('action')
                .setDescription('Punishment')
                .setRequired(true)
                .addChoices({ name: 'Mute', value: 'mute' }, { name: 'Kick', value: 'kick' }, { name: 'Ban', value: 'ban' }),
            )
            .addStringOption((o) => o.setName('duration').setDescription('Duration: 10m, 2h, 7d… (required for mutes)')),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove an automatic punishment')
            .addIntegerOption((o) => o.setName('warns').setDescription('Active warnings').setRequired(true).setMinValue(1).setMaxValue(50)),
        ),
    ),
  cooldownMs: 2_000,

  async execute(interaction, ctx) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const onOff = (value: boolean) => ctx.t(value ? 'moderation.settings.on' : 'moderation.settings.off');

    if (sub === 'show') {
      const config = await ctx.getConfig(interaction.guildId!);
      const rules = [...config.escalation].sort((a, b) => a.warns - b.warns).map((r) => describeRule(ctx, r));
      const embed = new EmbedBuilder().setTitle(ctx.t('moderation.name')).addFields(
        { name: ctx.t('moderation.settings.logChannel'), value: config.logChannelId ? channelMention(config.logChannelId) : onOff(false), inline: true },
        { name: ctx.t('moderation.settings.dm'), value: onOff(config.dmOnAction), inline: true },
        { name: ctx.t('moderation.settings.requireReason'), value: onOff(config.requireReason), inline: true },
        {
          name: ctx.t('moderation.settings.warnExpiry'),
          value: config.warnExpiryDays > 0 ? ctx.t('moderation.settings.days', { days: config.warnExpiryDays }) : ctx.t('moderation.settings.never'),
          inline: true,
        },
        { name: ctx.t('moderation.settings.escalation'), value: rules.join('\n') || onOff(false) },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'log-channel') {
      const channel = interaction.options.getChannel('channel') as GuildBasedChannel | null;
      if (channel) {
        const me = channel.guild.members.me;
        const perms = me ? channel.permissionsFor(me) : null;
        if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
          return void (await reply(interaction, ctx.t('moderation.settings.noAccess', { channel: channelMention(channel.id) })));
        }
      }
      if (!(await updateConfig(ctx, interaction, (c) => ({ ...c, logChannelId: channel?.id ?? null })))) return;
      await reply(interaction, channel ? ctx.t('moderation.settings.logSet', { channel: channelMention(channel.id) }) : ctx.t('moderation.settings.logOff'));
      return;
    }

    if (sub === 'dm' || sub === 'require-reason') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const key = sub === 'dm' ? 'dmOnAction' : 'requireReason';
      if (!(await updateConfig(ctx, interaction, (c) => ({ ...c, [key]: enabled })))) return;
      await reply(interaction, ctx.t(`moderation.settings.${sub === 'dm' ? 'dm' : 'requireReason'}Set`, { state: onOff(enabled) }));
      return;
    }

    if (sub === 'warn-expiry') {
      const days = interaction.options.getInteger('days', true);
      if (!(await updateConfig(ctx, interaction, (c) => ({ ...c, warnExpiryDays: days })))) return;
      await reply(interaction, days > 0 ? ctx.t('moderation.settings.expirySet', { days }) : ctx.t('moderation.settings.expiryNever'));
      return;
    }

    if (group === 'escalation') {
      const warns = interaction.options.getInteger('warns', true);
      if (sub === 'remove') {
        const config = await ctx.getConfig(interaction.guildId!);
        if (!config.escalation.some((r) => r.warns === warns)) return void (await reply(interaction, ctx.t('moderation.settings.noRule', { warns })));
        if (!(await updateConfig(ctx, interaction, (c) => ({ ...c, escalation: c.escalation.filter((r) => r.warns !== warns) })))) return;
        await reply(interaction, ctx.t('moderation.settings.ruleRemoved', { warns }));
        return;
      }

      const action = interaction.options.getString('action', true) as Rule['action'];
      const raw = interaction.options.getString('duration');
      const durationSec = raw ? parseDuration(raw) : null;
      if ((raw && durationSec === null) || (action === 'mute' && (!durationSec || durationSec > MAX_TIMEOUT_SEC))) {
        return void (await reply(interaction, ctx.t('moderation.settings.badRuleDuration')));
      }
      // Kicks have no duration; a ban with one is temporary.
      const rule: Rule = { warns, action, durationSec: action === 'kick' ? null : durationSec };
      const saved = await updateConfig(ctx, interaction, (c) => ({
        ...c,
        escalation: [...c.escalation.filter((r) => r.warns !== warns), rule].sort((a, b) => a.warns - b.warns),
      }));
      if (saved) await reply(interaction, ctx.t('moderation.settings.ruleSet', { rule: describeRule(ctx, rule) }));
    }
  },
});

export const slowmode = defineCommand<ModerationConfig>({
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set the channel slowmode')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('interval').setDescription('Interval: 10s, 5m, 1h; 0 — off').setRequired(true).setMaxLength(20))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel; the current one by default')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.PublicThread, ChannelType.PrivateThread),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const raw = interaction.options.getString('interval', true).trim();
    const seconds = raw === '0' ? 0 : parseDuration(raw);
    // Discord allows up to six hours.
    if (seconds === null || seconds > 21_600) return void (await reply(interaction, ctx.t('moderation.errors.invalidSlowmode')));

    const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as GuildBasedChannel | null;
    if (!channel || !('setRateLimitPerUser' in channel)) return void (await reply(interaction, ctx.t('moderation.errors.noSlowmode')));
    const me = channel.guild.members.me;
    if (!me || !channel.permissionsFor(me).has(PermissionFlagsBits.ManageChannels)) {
      return void (await reply(interaction, ctx.t('moderation.errors.noSlowmodeAccess', { channel: channelMention(channel.id) })));
    }

    const reason = interaction.options.getString('reason') ?? undefined;
    await channel.setRateLimitPerUser(seconds, `${interaction.user.username}: ${reason ?? '—'}`);
    await reply(
      interaction,
      seconds === 0
        ? ctx.t('moderation.done.slowmodeOff', { channel: channelMention(channel.id) })
        : ctx.t('moderation.done.slowmode', { channel: channelMention(channel.id), interval: formatDuration(seconds, ctx.locale) }),
    );
  },
});
