import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Player, Track } from 'lavalink-client';
import { escapeTitle, formatDuration, progressBar } from './format.js';
import { requesterOf } from './tracks.js';

export const COMPONENT_PREFIX = 'music';
export const EMBED_COLOR = 0x1db954;

type T = (key: string, vars?: Record<string, string | number>) => string;

export function trackLink(track: Track): string {
  const title = escapeTitle(track.info.title);
  return track.info.uri ? `[${title}](${track.info.uri})` : `**${title}**`;
}

export function trackLength(t: T, track: Track): string {
  return track.info.isStream ? t('music.live') : formatDuration(track.info.duration);
}

export function nowPlayingEmbed(t: T, player: Player, track: Track): EmbedBuilder {
  const requester = requesterOf(track);
  const position = track.info.isStream
    ? `🔴 ${t('music.live')}`
    : `${progressBar(player.position, track.info.duration)} ${formatDuration(player.position)} / ${formatDuration(track.info.duration)}`;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: t(player.paused ? 'music.nowPlaying.paused' : 'music.nowPlaying.title') })
    .setDescription(`${trackLink(track)}\n${escapeTitle(track.info.author)}\n\n${position}`)
    .addFields(
      { name: t('music.fields.requester'), value: requester ? `<@${requester.id}>` : '—', inline: true },
      { name: t('music.fields.volume'), value: `${player.volume}%`, inline: true },
      { name: t('music.fields.repeat'), value: t(`music.repeat.${player.repeatMode}`), inline: true },
    )
    .setFooter({
      text: player.queue.tracks.length > 0 ? t('music.nowPlaying.queue', { count: player.queue.tracks.length }) : t('music.nowPlaying.queueEmpty'),
    });
  if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);
  return embed;
}

/** Player buttons: `music:<action>`. */
export function playerButtons(player: Player): ActionRowBuilder<ButtonBuilder> {
  const button = (action: string, emoji: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(`${COMPONENT_PREFIX}:${action}`).setEmoji(emoji).setStyle(style);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('previous', '⏮').setDisabled(player.queue.previous.length === 0),
    button('toggle', player.paused ? '▶' : '⏸', ButtonStyle.Primary),
    button('skip', '⏭'),
    button('repeat', player.repeatMode === 'track' ? '🔂' : '🔁', player.repeatMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
    button('stop', '⏹', ButtonStyle.Danger),
  );
}

export function nowPlayingMessage(t: T, player: Player, track: Track) {
  return { embeds: [nowPlayingEmbed(t, player, track)], components: [playerButtons(player)], allowedMentions: { parse: [] } };
}

/** `off → queue → track → off` for the repeat button. */
export function nextRepeatMode(mode: Player['repeatMode']): Player['repeatMode'] {
  return mode === 'off' ? 'queue' : mode === 'queue' ? 'track' : 'off';
}
