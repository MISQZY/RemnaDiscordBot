import { defineCommand, type InteractionContext } from '@bot/core';
import {
  channelMention,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import type { ModerationConfig } from './config.js';
import { formatDuration, parseDuration } from './duration.js';
import { LockdownService } from './lockdown.js';

type Ctx = InteractionContext<ModerationConfig>;

const LOCKABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice] as const;

const channelOption = (s: SlashCommandSubcommandBuilder) =>
  s.addChannelOption((o) => o.setName('channel').setDescription('Channel; the current one by default').addChannelTypes(...LOCKABLE));

/** A notice in each channel the lockdown changed, in the server's language. */
async function announce(guild: Guild, channelIds: readonly string[], text: string): Promise<void> {
  for (const id of channelIds) {
    const channel = guild.channels.cache.get(id);
    if (channel?.isSendable()) await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
  }
}

function summary(ctx: Ctx, key: 'locked' | 'unlocked', channelIds: readonly string[], extra: string[] = []): string {
  const shown = channelIds.slice(0, 20).map(channelMention).join(', ');
  const more = channelIds.length > 20 ? ` +${channelIds.length - 20}` : '';
  return [ctx.t(`moderation.lockdown.${key}`, { count: channelIds.length, channels: `${shown}${more}` }), ...extra].join('\n');
}

async function lock(interaction: ChatInputCommandInteraction, ctx: Ctx, server: boolean): Promise<void> {
  const guild = interaction.guild!;
  const config = await ctx.getConfig(guild.id);
  const raw = interaction.options.getString('duration');
  const durationSec = raw ? parseDuration(raw) : null;
  if (raw && !durationSec) return void (await interaction.reply({ content: ctx.t('moderation.errors.invalidDuration'), flags: MessageFlags.Ephemeral }));

  const reasonText = interaction.options.getString('reason');
  const service = new LockdownService(ctx);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channelIds = server
    ? config.lockdown.channelIds.length > 0
      ? config.lockdown.channelIds
      : await service.serverChannels(guild.id)
    : [(interaction.options.getChannel('channel') ?? interaction.channel)!.id];
  const until = durationSec ? new Date(Date.now() + durationSec * 1000) : null;
  const result = await service.lock(guild.id, channelIds, {
    reason: `Lockdown by ${interaction.user.username}: ${reasonText ?? '—'}`.slice(0, 512),
    until,
    scope: server ? 'server' : channelIds[0]!,
  });

  if (config.lockdown.announce) {
    const notice = [
      ctx.tGuild('moderation.lockdown.notice'),
      reasonText ? ctx.tGuild('moderation.lockdown.reason', { reason: reasonText }) : null,
      until ? ctx.tGuild('moderation.lockdown.until', { time: `<t:${Math.floor(until.getTime() / 1000)}:R>` }) : null,
    ].filter(Boolean);
    await announce(guild, result.locked, notice.join('\n'));
  }

  const extra = [
    durationSec ? ctx.t('moderation.lockdown.for', { duration: formatDuration(durationSec, ctx.locale) }) : null,
    result.skipped.length > 0 ? ctx.t('moderation.lockdown.skipped', { count: result.skipped.length }) : null,
    result.failed.length > 0 ? ctx.t('moderation.lockdown.failed', { channels: result.failed.slice(0, 20).map(channelMention).join(', ') }) : null,
  ].filter((line): line is string => line !== null);
  await interaction.editReply({ content: summary(ctx, 'locked', result.locked, extra), allowedMentions: { parse: [] } });
}

export const lockdown = defineCommand<ModerationConfig>({
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Stop @everyone from writing in channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      channelOption(s.setName('channel').setDescription('Lock one channel'))
        .addStringOption((o) => o.setName('duration').setDescription('Unlock after: 10m, 2h…; empty — until /unlock').setMaxLength(20))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('server')
        .setDescription('Lock every public channel (or the ones from the settings)')
        .addStringOption((o) => o.setName('duration').setDescription('Unlock after: 10m, 2h…; empty — until /unlock').setMaxLength(20))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),
    ),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    await lock(interaction, ctx, interaction.options.getSubcommand() === 'server');
  },
});

export const unlock = defineCommand<ModerationConfig>({
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Lift a lockdown')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => channelOption(s.setName('channel').setDescription('Unlock one channel')))
    .addSubcommand((s) => s.setName('server').setDescription('Unlock every channel the bot locked')),
  cooldownMs: 5_000,
  async execute(interaction, ctx) {
    const guild = interaction.guild!;
    const server = interaction.options.getSubcommand() === 'server';
    const channelId = server ? null : (interaction.options.getChannel('channel') ?? interaction.channel)!.id;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const unlocked = await new LockdownService(ctx).unlock(guild.id, channelId ? [channelId] : null, {
      reason: `Unlock by ${interaction.user.username}`,
      scope: channelId ?? undefined,
    });
    if (unlocked.length === 0) return void (await interaction.editReply(ctx.t('moderation.lockdown.nothing')));
    const config = await ctx.getConfig(guild.id);
    if (config.lockdown.announce) await announce(guild, unlocked, ctx.tGuild('moderation.lockdown.lifted'));
    await interaction.editReply({ content: summary(ctx, 'unlocked', unlocked), allowedMentions: { parse: [] } });
  },
});
