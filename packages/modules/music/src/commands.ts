import { defineCommand, defineComponent, type InteractionContext } from '@bot/core';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type VoiceBasedChannel,
} from 'discord.js';
import type { Player } from 'lavalink-client';
import type { MusicConfig } from './config.js';
import { escapeTitle, formatDuration, parseTimestamp } from './format.js';
import { COMPONENT_PREFIX, EMBED_COLOR, nextRepeatMode, nowPlayingMessage, trackLength, trackLink } from './messages.js';
import type { MusicService } from './service.js';
import { requesterOf } from './tracks.js';

type Ctx = InteractionContext<MusicConfig>;
type Repliable = ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

const QUEUE_PAGE_SIZE = 10;

/** The cluster's player service; null until `bot.setup` runs or when Lavalink is not configured. */
export const runtime: { service: MusicService | null } = { service: null };

async function deny(interaction: Repliable, ctx: Ctx, key: string, vars?: Record<string, string | number>): Promise<null> {
  const options = { content: ctx.t(key, vars), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } } as const;
  if (interaction.replied || interaction.deferred) await interaction.followUp(options);
  else await interaction.reply(options);
  return null;
}

const badPosition = (interaction: Repliable, ctx: Ctx, player: Player | undefined) => {
  const max = player?.queue.tracks.length ?? 0;
  return max === 0 ? deny(interaction, ctx, 'music.errors.queueEmpty') : deny(interaction, ctx, 'music.errors.badPosition', { max });
};

function service(): MusicService | null {
  return runtime.service?.available ? runtime.service : null;
}

/** DJ roles: when set, only they, server managers and a lone listener steer the player. */
export function canControl(member: GuildMember, config: MusicConfig, player: Player | undefined): boolean {
  if (config.djRoleIds.length === 0) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (config.djRoleIds.some((id) => member.roles.cache.has(id))) return true;
  const channel = member.voice.channel;
  return Boolean(player && channel?.id === player.voiceChannelId && channel.members.filter((m) => !m.user.bot).size === 1);
}

interface Session {
  music: MusicService;
  member: GuildMember;
  voice: VoiceBasedChannel;
  config: MusicConfig;
  player: Player | undefined;
}

/** Common checks: Lavalink is up and the member listens in the bot's channel. */
async function session(interaction: Repliable, ctx: Ctx): Promise<Session | null> {
  const music = service();
  if (!music) return deny(interaction, ctx, 'music.errors.unavailable');
  const member = interaction.member;
  if (!(member instanceof GuildMember)) return null;
  const voice = member.voice.channel;
  if (!voice) return deny(interaction, ctx, 'music.errors.joinVoice');
  const player = music.getPlayer(member.guild.id);
  if (player?.voiceChannelId && player.voiceChannelId !== voice.id) {
    return deny(interaction, ctx, 'music.errors.otherChannel', { channel: `<#${player.voiceChannelId}>` });
  }
  return { music, member, voice, config: await ctx.getConfig(member.guild.id), player };
}

/** A session with a playing player and the right to steer it. */
async function controlSession(interaction: Repliable, ctx: Ctx, { allowRequester = false } = {}): Promise<(Session & { player: Player }) | null> {
  const s = await session(interaction, ctx);
  if (!s) return null;
  if (!s.player?.queue.current) return deny(interaction, ctx, 'music.errors.nothingPlaying');
  const ownTrack = allowRequester && requesterOf(s.player.queue.current)?.id === s.member.id;
  if (!ownTrack && !canControl(s.member, s.config, s.player)) return deny(interaction, ctx, 'music.errors.djOnly');
  return { ...s, player: s.player };
}

const reply = (interaction: ChatInputCommandInteraction, content: string) =>
  interaction.reply({ content, allowedMentions: { parse: [] } });

export const play = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track or a playlist')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o.setName('query').setDescription('Link or search text').setRequired(true).setMaxLength(500).setAutocomplete(true),
    ),
  cooldownMs: 2_000,

  async autocomplete(interaction, ctx) {
    const query = interaction.options.getFocused().trim();
    const music = service();
    if (!music || query.length < 2 || /^https?:\/\//i.test(query)) {
      await interaction.respond([]);
      return;
    }
    try {
      const config = await ctx.getConfig(interaction.guildId!);
      const tracks = await music.suggest(query, config, { id: interaction.user.id, username: interaction.user.username });
      await interaction.respond(
        tracks
          .filter((t) => t.info.uri && t.info.uri.length <= 100)
          .slice(0, 25)
          .map((t) => ({
            name: `${escapeTitle(t.info.title, 70)} — ${escapeTitle(t.info.author, 20)} (${t.info.isStream ? '🔴' : formatDuration(t.info.duration)})`.slice(0, 100),
            value: t.info.uri,
          })),
      );
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  },

  async execute(interaction, ctx) {
    const s = await session(interaction, ctx);
    if (!s) return;
    if (s.config.allowedVoiceChannelIds.length > 0 && !s.config.allowedVoiceChannelIds.includes(s.voice.id)) {
      await deny(interaction, ctx, 'music.errors.channelNotAllowed');
      return;
    }
    const me = s.member.guild.members.me;
    const perms = me ? s.voice.permissionsFor(me) : null;
    if (!s.player && (!perms?.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak) || !s.voice.joinable)) {
      await deny(interaction, ctx, 'music.errors.noVoicePermissions');
      return;
    }

    await interaction.deferReply();
    const query = interaction.options.getString('query', true);
    const result = await s.music.enqueue(s.member, s.voice, interaction.channelId, query, s.config);
    const edit = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });
    switch (result.kind) {
      case 'track':
        await edit(
          result.started
            ? ctx.tGuild('music.play.started', { track: trackLink(result.track), length: trackLength(ctx.tGuild, result.track) })
            : ctx.tGuild('music.play.queued', { track: trackLink(result.track), length: trackLength(ctx.tGuild, result.track), position: result.position }),
        );
        return;
      case 'playlist':
        await edit(
          ctx.tGuild('music.play.playlist', { name: escapeTitle(result.name || '—'), count: result.added }) +
            (result.skipped > 0 ? `\n${ctx.tGuild('music.play.playlistSkipped', { count: result.skipped })}` : ''),
        );
        return;
      case 'empty':
        await edit(ctx.t('music.errors.notFound'));
        return;
      case 'tooLong':
        await edit(ctx.t('music.errors.tooLong', { max: formatDuration(s.config.maxTrackDurationSec * 1000) }));
        return;
      case 'queueFull':
        await edit(ctx.t('music.errors.queueFull', { max: s.config.maxQueueSize }));
        return;
      case 'badLink':
        await edit(ctx.t('music.errors.badLink'));
        return;
      case 'failed':
        await edit(ctx.t('music.errors.loadFailed'));
        return;
    }
  },
});

export const skip = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('to').setDescription('Skip to this queue position').setMinValue(1)),
  async execute(interaction, ctx) {
    const to = interaction.options.getInteger('to');
    const s = await controlSession(interaction, ctx, { allowRequester: to === null });
    if (!s) return;
    const skipped = s.player.queue.current!;
    if (to !== null) {
      if (to > s.player.queue.tracks.length) {
        await badPosition(interaction, ctx, s.player);
        return;
      }
      await s.player.skip(to, false);
    } else {
      await s.music.control(s.member.guild.id, { action: 'skip' });
    }
    await reply(interaction, ctx.tGuild('music.skipped', { track: trackLink(skipped), user: `<@${s.member.id}>` }));
  },
});

export const stop = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback, clear the queue and leave').setContexts(InteractionContextType.Guild),
  async execute(interaction, ctx) {
    const s = await session(interaction, ctx);
    if (!s) return;
    if (!s.player) {
      await deny(interaction, ctx, 'music.errors.nothingPlaying');
      return;
    }
    if (!canControl(s.member, s.config, s.player)) {
      await deny(interaction, ctx, 'music.errors.djOnly');
      return;
    }
    await s.music.control(s.member.guild.id, { action: 'stop' });
    await reply(interaction, ctx.tGuild('music.stopped', { user: `<@${s.member.id}>` }));
  },
});

export const pause = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause or resume playback').setContexts(InteractionContextType.Guild),
  async execute(interaction, ctx) {
    const s = await controlSession(interaction, ctx);
    if (!s) return;
    const paused = !s.player.paused;
    await s.music.control(s.member.guild.id, { action: paused ? 'pause' : 'resume' });
    await reply(interaction, ctx.tGuild(paused ? 'music.paused' : 'music.resumed'));
  },
});

export const nowplaying = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track').setContexts(InteractionContextType.Guild),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const player = service()?.getPlayer(interaction.guildId!);
    const track = player?.queue.current;
    if (!player || !track) {
      await deny(interaction, ctx, 'music.errors.nothingPlaying');
      return;
    }
    const { embeds, components } = nowPlayingMessage(ctx.tGuild, player, track);
    await interaction.reply({ embeds, components, allowedMentions: { parse: [] } });
  },
});

function queuePage(ctx: Ctx, player: Player, page: number) {
  const tracks = player.queue.tracks;
  const pages = Math.max(1, Math.ceil(tracks.length / QUEUE_PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * QUEUE_PAGE_SIZE;
  const lines = tracks
    .slice(start, start + QUEUE_PAGE_SIZE)
    .map((t, i) => `**${start + i + 1}.** ${escapeTitle(t.info.title, 60)} · ${t.info.isStream ? ctx.tGuild('music.live') : formatDuration(t.info.duration ?? 0)}`);
  const total = player.queue.utils.totalDuration();
  const playing = player.queue.current;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(ctx.tGuild('music.queue.title'))
    .setDescription(
      [
        playing ? ctx.tGuild('music.queue.current', { track: trackLink(playing), length: trackLength(ctx.tGuild, playing) }) : null,
        '',
        lines.length > 0 ? lines.join('\n') : ctx.tGuild('music.queue.empty'),
      ]
        .filter((line) => line !== null)
        .join('\n'),
    )
    .setFooter({ text: ctx.tGuild('music.queue.footer', { count: tracks.length, duration: formatDuration(total), page: current + 1, pages }) });
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${COMPONENT_PREFIX}:queue:${current - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(current <= 0),
    new ButtonBuilder().setCustomId(`${COMPONENT_PREFIX}:queue:${current + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(current + 1 >= pages),
  );
  return { embeds: [embed], components: pages > 1 ? [buttons] : [], allowedMentions: { parse: [] } };
}

export const queue = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the queue')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1)),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const player = service()?.getPlayer(interaction.guildId!);
    if (!player?.queue.current) {
      await deny(interaction, ctx, 'music.errors.nothingPlaying');
      return;
    }
    await interaction.reply(queuePage(ctx, player, (interaction.options.getInteger('page') ?? 1) - 1));
  },
});

export const volume = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Change the volume')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('percent').setDescription('Volume, %').setRequired(true).setMinValue(0).setMaxValue(150)),
  async execute(interaction, ctx) {
    const s = await controlSession(interaction, ctx);
    if (!s) return;
    const value = interaction.options.getInteger('percent', true);
    await s.music.control(s.member.guild.id, { action: 'volume', value });
    await reply(interaction, ctx.tGuild('music.volumeSet', { volume: value }));
  },
});

export const loop = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Repeat the track or the queue')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('What to repeat')
        .setRequired(true)
        .addChoices({ name: 'Off', value: 'off' }, { name: 'Track', value: 'track' }, { name: 'Queue', value: 'queue' }),
    ),
  async execute(interaction, ctx) {
    const s = await controlSession(interaction, ctx);
    if (!s) return;
    const mode = interaction.options.getString('mode', true) as Player['repeatMode'];
    await s.music.control(s.member.guild.id, { action: 'repeat', value: mode });
    await reply(interaction, ctx.tGuild('music.repeatSet', { mode: ctx.tGuild(`music.repeat.${mode}`) }));
  },
});

export const shuffle = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue').setContexts(InteractionContextType.Guild),
  async execute(interaction, ctx) {
    const s = await controlSession(interaction, ctx);
    if (!s) return;
    if (!(await s.music.control(s.member.guild.id, { action: 'shuffle' }))) {
      await deny(interaction, ctx, 'music.errors.queueTooShort');
      return;
    }
    await reply(interaction, ctx.tGuild('music.shuffled', { count: s.player.queue.tracks.length }));
  },
});

export const remove = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('position').setDescription('Queue position').setRequired(true).setMinValue(1)),
  async execute(interaction, ctx) {
    const s = await session(interaction, ctx);
    if (!s) return;
    const position = interaction.options.getInteger('position', true);
    const target = s.player?.queue.tracks[position - 1];
    if (!s.player || !target) {
      await badPosition(interaction, ctx, s.player);
      return;
    }
    // Members may take back what they queued themselves.
    if (requesterOf(target)?.id !== s.member.id && !canControl(s.member, s.config, s.player)) {
      await deny(interaction, ctx, 'music.errors.djOnly');
      return;
    }
    await s.music.control(s.member.guild.id, { action: 'remove', value: position });
    await reply(interaction, ctx.tGuild('music.removed', { track: escapeTitle(target.info.title) }));
  },
});

export const seek = defineCommand<MusicConfig>({
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Jump to a moment of the track')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('time').setDescription('For example 1:30').setRequired(true).setMaxLength(10)),
  async execute(interaction, ctx) {
    const s = await controlSession(interaction, ctx);
    if (!s) return;
    const position = parseTimestamp(interaction.options.getString('time', true));
    if (position === null) {
      await deny(interaction, ctx, 'music.errors.badTime');
      return;
    }
    if (!(await s.music.control(s.member.guild.id, { action: 'seek', value: position }))) {
      await deny(interaction, ctx, 'music.errors.notSeekable');
      return;
    }
    await reply(interaction, ctx.tGuild('music.seeked', { time: formatDuration(position) }));
  },
});

/** Buttons: `music:queue:<page>` and the player's `music:<action>`. */
export const buttons = defineComponent<MusicConfig>({
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.guildId) return;
    const [, action, arg] = interaction.customId.split(':');

    if (action === 'queue') {
      const player = service()?.getPlayer(interaction.guildId);
      if (!player?.queue.current) {
        await deny(interaction, ctx, 'music.errors.nothingPlaying');
        return;
      }
      await interaction.update(queuePage(ctx, player, Number(arg) || 0));
      return;
    }

    const s = await controlSession(interaction, ctx, { allowRequester: action === 'skip' });
    if (!s) return;
    const guildId = s.member.guild.id;
    switch (action) {
      case 'toggle':
        await s.music.control(guildId, { action: s.player.paused ? 'resume' : 'pause' });
        break;
      case 'skip':
        await s.music.control(guildId, { action: 'skip' });
        await interaction.deferUpdate();
        return;
      case 'previous':
        await s.music.control(guildId, { action: 'previous' });
        await interaction.deferUpdate();
        return;
      case 'repeat':
        await s.music.control(guildId, { action: 'repeat', value: nextRepeatMode(s.player.repeatMode) });
        break;
      case 'stop':
        await interaction.deferUpdate();
        await s.music.control(guildId, { action: 'stop' });
        return;
      default:
        return;
    }
    const track = s.player.queue.current;
    if (!track) await interaction.deferUpdate();
    else await interaction.update(nowPlayingMessage(ctx.tGuild, s.player, track));
  },
});

export const commands = [play, skip, stop, pause, nowplaying, queue, volume, loop, shuffle, remove, seek];
