import type { BotModuleContext } from '@bot/core';
import {
  Events,
  type Client,
  type GuildMember,
  type Message,
  type SendableChannels,
  type VoiceBasedChannel,
  type VoiceState,
} from 'discord.js';
import type { Redis } from 'ioredis';
import {
  LavalinkManager,
  type LavalinkNodeOptions,
  type Player,
  type RepeatMode,
  type SearchResult,
  type Track,
  type UnresolvedSearchResult,
  type UnresolvedTrack,
} from 'lavalink-client';
import { SearchSource, type MusicConfig } from './config.js';
import { SEARCH_PLATFORMS } from './format.js';
import { nowPlayingMessage } from './messages.js';
import { PROBE_INTERVAL_MS, PROBE_QUERY, SOURCES_TTL_SEC, supportedSources, type SourcesState } from './sources.js';
import {
  ControlMessage,
  MusicKeys,
  RESUME_TTL_SEC,
  STATE_QUEUE_PREVIEW,
  STATE_TTL_SEC,
  type ControlAction,
  type PlayerState,
} from './state.js';
import { playableQuery, trackView, type Requester } from './tracks.js';

type Ctx = BotModuleContext<MusicConfig>;

export type EnqueueResult =
  | { kind: 'track'; track: Track; position: number; started: boolean }
  | { kind: 'playlist'; name: string; added: number; skipped: number; started: boolean }
  | { kind: 'empty' }
  | { kind: 'tooLong'; track: Track }
  | { kind: 'queueFull' }
  | { kind: 'failed'; message: string }
  | { kind: 'badLink' };

/** What a restart keeps of a player: where it played and the tracks with their encoded data. */
interface ResumeSnapshot {
  voiceChannelId: string;
  textChannelId: string | null;
  volume: number;
  repeatMode: RepeatMode;
  paused: boolean;
  positionMs: number;
  current: Track;
  tracks: Track[];
}

const NOW_PLAYING_KEY = 'nowPlayingMessageId';
const SEARCH_TIMEOUT_MS = 8_000;
/** The player waits this long on an empty queue before leaving. */
const EMPTY_QUEUE_LEAVE_MS = 120_000;

/**
 * Lavalink players of this cluster's guilds. The bot only steers players; Lavalink loads and streams the audio.
 * Created in `bot.setup` when `LAVALINK_NODES` is set.
 */
export class MusicService {
  readonly manager: LavalinkManager;
  private readonly aloneTimers = new Map<string, NodeJS.Timeout>();
  private subscriber: Redis | null = null;
  private sourcesTimer: NodeJS.Timeout | null = null;
  private resumed = false;

  constructor(
    private readonly ctx: Ctx,
    nodes: LavalinkNodeOptions[],
  ) {
    const client = ctx.client;
    this.manager = new LavalinkManager({
      nodes,
      sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
      autoSkip: true,
      autoSkipOnResolveError: true,
      queueOptions: { maxPreviousTracks: 25 },
      playerOptions: {
        defaultSearchPlatform: 'scsearch',
        // Only what the queue needs of the user: the full discord.js object does not serialize.
        requesterTransformer: (user) => {
          const u = user as Partial<Requester> & { username?: string };
          return { id: u.id ?? '', username: u.username ?? '' } satisfies Requester;
        },
        onDisconnect: { autoReconnect: true, destroyPlayer: false },
        onEmptyQueue: { destroyAfterMs: EMPTY_QUEUE_LEAVE_MS },
      },
    });
    this.bindManagerEvents();
  }

  get available(): boolean {
    return this.manager.useable;
  }

  getPlayer(guildId: string): Player | undefined {
    return this.manager.getPlayer(guildId);
  }

  /** Hooks into the gateway: raw voice packets feed Lavalink, the ready event initializes it. */
  async start(): Promise<void> {
    const client = this.ctx.client;
    client.on(Events.Raw, (packet) => void this.manager.sendRawData(packet));
    const init = (ready: Client<true>) =>
      void this.manager.init({ id: ready.user.id, username: ready.user.username }).catch((err: unknown) => {
        this.ctx.logger.error({ err }, 'Lavalink manager failed to start');
      });
    if (client.isReady()) init(client);
    else client.once(Events.ClientReady, init);

    this.subscriber = this.ctx.redis.duplicate();
    this.subscriber.on('error', (err) => this.ctx.logger.warn({ err }, 'Music control subscriber error'));
    this.subscriber.on('message', (_channel, raw: string) => void this.onControlMessage(raw));
    await this.subscriber.subscribe(MusicKeys.control);
    this.sourcesTimer = setInterval(() => void this.checkSources(), PROBE_INTERVAL_MS).unref();
  }

  /** Saves playing players for the next start and leaves the voice channels. */
  async stop(): Promise<void> {
    for (const timer of this.aloneTimers.values()) clearTimeout(timer);
    this.aloneTimers.clear();
    if (this.sourcesTimer) clearInterval(this.sourcesTimer);
    await this.subscriber?.quit().catch(() => {});

    for (const player of [...this.manager.players.values()]) {
      try {
        await this.saveForResume(player);
        await player.destroy('ClusterShutdown', true);
      } catch (err) {
        this.ctx.logger.warn({ err, guildId: player.guildId }, 'Player not saved on shutdown');
      }
    }
  }

  // ─── Playback ───────────────────────────────────────────────────────────

  /** Joins the member's voice channel if needed and queues what the query finds. */
  async enqueue(
    member: GuildMember,
    voice: VoiceBasedChannel,
    textChannelId: string,
    query: string,
    config: MusicConfig,
  ): Promise<EnqueueResult> {
    if (!playableQuery(query)) return { kind: 'badLink' };
    const player = this.manager.createPlayer({
      guildId: member.guild.id,
      voiceChannelId: voice.id,
      textChannelId,
      selfDeaf: true,
      volume: config.defaultVolume,
    });
    const requester: Requester = { id: member.id, username: member.user.username };

    let result: SearchResult | UnresolvedSearchResult;
    try {
      result = await withTimeout(player.search({ query, source: SEARCH_PLATFORMS[config.searchSource] }, requester), SEARCH_TIMEOUT_MS);
    } catch (err) {
      this.ctx.logger.debug({ err, guildId: member.guild.id }, 'Music search failed');
      if (!player.queue.current) await player.destroy('SearchFailed');
      return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
    }

    const cleanupIdle = async () => {
      if (!player.queue.current && player.queue.tracks.length === 0) await player.destroy('NothingQueued');
    };

    if (result.loadType === 'error' || result.loadType === 'empty' || result.tracks.length === 0) {
      await cleanupIdle();
      return result.loadType === 'error' ? { kind: 'failed', message: result.exception?.message ?? '' } : { kind: 'empty' };
    }

    const fits = (t: Track | UnresolvedTrack) =>
      config.maxTrackDurationSec === 0 || t.info.isStream || (t.info.duration ?? 0) <= config.maxTrackDurationSec * 1000;
    const room = config.maxQueueSize - player.queue.tracks.length;

    if (result.loadType === 'playlist') {
      const allowed = result.tracks.filter(fits);
      const added = allowed.slice(0, Math.max(0, room));
      if (added.length === 0) {
        await cleanupIdle();
        return { kind: 'queueFull' };
      }
      await player.queue.add(added);
      const started = await this.ensurePlaying(player, voice);
      await this.publishState(player);
      return { kind: 'playlist', name: result.playlist?.name ?? '', added: added.length, skipped: result.tracks.length - added.length, started };
    }

    const track = result.tracks[0] as Track;
    if (!fits(track)) {
      await cleanupIdle();
      return { kind: 'tooLong', track };
    }
    if (room <= 0) return { kind: 'queueFull' };
    await player.queue.add(track);
    const position = player.queue.tracks.length;
    const started = await this.ensurePlaying(player, voice);
    await this.publishState(player);
    return { kind: 'track', track, position: started ? 0 : position, started };
  }

  /** Search suggestions for `/play` autocomplete. */
  async suggest(query: string, config: MusicConfig, requester: Requester): Promise<Track[]> {
    const node = this.manager.nodeManager.leastUsedNodes()[0];
    if (!node) return [];
    const result = await withTimeout(node.search({ query, source: SEARCH_PLATFORMS[config.searchSource] }, requester), 2_500);
    return result.loadType === 'search' || result.loadType === 'track' ? result.tracks.slice(0, 10) : [];
  }

  private async ensurePlaying(player: Player, voice: VoiceBasedChannel): Promise<boolean> {
    if (!player.connected) await player.connect();
    else if (player.voiceChannelId !== voice.id) await player.changeVoiceState({ voiceChannelId: voice.id });
    if (player.playing || player.paused || player.queue.current) return false;
    await player.play();
    return true;
  }

  /** Executes a player action from a command, a button or the dashboard. False — nothing to act on. */
  async control(guildId: string, action: ControlAction): Promise<boolean> {
    const player = this.getPlayer(guildId);
    if (!player) return false;
    switch (action.action) {
      case 'pause':
        if (player.paused) return false;
        await player.pause();
        break;
      case 'resume':
        if (!player.paused) return false;
        await player.resume();
        break;
      case 'skip':
        if (!player.queue.current) return false;
        await player.skip(0, false);
        break;
      case 'previous': {
        const previous = await player.queue.shiftPrevious();
        if (!previous) return false;
        if (player.queue.current) await player.queue.add(player.queue.current, 0);
        await player.play({ clientTrack: previous });
        break;
      }
      case 'stop':
        await player.destroy('Stopped');
        return true;
      case 'shuffle':
        if (player.queue.tracks.length < 2) return false;
        await player.queue.shuffle();
        break;
      case 'volume':
        await player.setVolume(action.value);
        break;
      case 'repeat':
        await player.setRepeatMode(action.value);
        break;
      case 'seek':
        if (!player.queue.current?.info.isSeekable) return false;
        await player.seek(Math.min(action.value, player.queue.current.info.duration));
        break;
      case 'remove': {
        if (action.value > player.queue.tracks.length) return false;
        await player.queue.remove(action.value - 1);
        break;
      }
    }
    await this.publishState(player);
    return true;
  }

  // ─── Voice channel watching ─────────────────────────────────────────────

  /** Leaves after the channel stays without listeners for `leaveWhenAloneSec`. */
  async onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guildId = newState.guild.id;
    const player = this.getPlayer(guildId);
    if (!player?.voiceChannelId) return;
    if (oldState.channelId !== player.voiceChannelId && newState.channelId !== player.voiceChannelId) return;

    const channel = newState.guild.channels.cache.get(player.voiceChannelId);
    const listeners = channel?.isVoiceBased() ? channel.members.filter((m) => !m.user.bot).size : 0;
    const timer = this.aloneTimers.get(guildId);
    if (listeners > 0) {
      if (timer) clearTimeout(timer);
      this.aloneTimers.delete(guildId);
      return;
    }
    if (timer) return;

    const { leaveWhenAloneSec } = await this.ctx.getConfig(guildId);
    if (leaveWhenAloneSec === 0) return;
    this.aloneTimers.set(
      guildId,
      setTimeout(() => {
        this.aloneTimers.delete(guildId);
        void this.getPlayer(guildId)?.destroy('ChannelEmpty');
      }, leaveWhenAloneSec * 1000).unref(),
    );
  }

  // ─── Events, state and announcements ────────────────────────────────────

  private bindManagerEvents(): void {
    const { manager, ctx } = this;
    manager.nodeManager.on('connect', (node) => {
      ctx.logger.info({ node: node.id }, 'Lavalink node connected');
      void this.resumeSaved();
      void this.checkSources(true);
    });
    manager.nodeManager.on('disconnect', (node, reason) => {
      ctx.logger.warn({ node: node.id, reason }, 'Lavalink node disconnected');
      void this.checkSources(true);
    });
    manager.nodeManager.on('error', (node, err) => ctx.logger.warn({ err, node: node.id }, 'Lavalink node error'));

    manager.on('trackStart', (player, track) => {
      void this.publishState(player);
      if (track) void this.announce(player, track);
    });
    manager.on('trackError', (player, track, payload) => {
      ctx.logger.debug({ guildId: player.guildId, track: track?.info.uri, exception: payload.exception }, 'Track failed');
    });
    manager.on('trackStuck', (player, track) => ctx.logger.debug({ guildId: player.guildId, track: track?.info.uri }, 'Track stuck'));
    manager.on('queueEnd', (player) => {
      void this.publishState(player);
      void this.clearNowPlaying(player);
    });
    manager.on('playerClientUpdate', (_old, player) => void this.publishState(player));
    manager.on('playerDestroy', (player, reason) => {
      const timer = this.aloneTimers.get(player.guildId);
      if (timer) clearTimeout(timer);
      this.aloneTimers.delete(player.guildId);
      void ctx.redis.del(MusicKeys.state(player.guildId)).catch(() => {});
      void this.clearNowPlaying(player);
      ctx.logger.debug({ guildId: player.guildId, reason }, 'Player destroyed');
    });
  }

  stateOf(player: Player): PlayerState {
    return {
      voiceChannelId: player.voiceChannelId,
      textChannelId: player.textChannelId,
      current: player.queue.current ? trackView(player.queue.current) : null,
      positionMs: Math.round(player.position),
      paused: player.paused,
      volume: player.volume,
      repeatMode: player.repeatMode,
      queue: player.queue.tracks.slice(0, STATE_QUEUE_PREVIEW).map(trackView),
      queueSize: player.queue.tracks.length,
      updatedAt: Date.now(),
    };
  }

  private async publishState(player: Player): Promise<void> {
    try {
      await this.ctx.redis.set(MusicKeys.state(player.guildId), JSON.stringify(this.stateOf(player)), 'EX', STATE_TTL_SEC);
    } catch (err) {
      this.ctx.logger.debug({ err, guildId: player.guildId }, 'Player state not published');
    }
  }

  private async textChannel(player: Player): Promise<SendableChannels | null> {
    if (!player.textChannelId) return null;
    const channel = await this.ctx.client.channels.fetch(player.textChannelId).catch(() => null);
    return channel?.isSendable() ? channel : null;
  }

  private async announce(player: Player, track: Track): Promise<void> {
    const config = await this.ctx.getConfig(player.guildId);
    if (!config.announceTracks) return;
    const channel = await this.textChannel(player);
    if (!channel) return;
    await this.clearNowPlaying(player);
    const locale = await this.ctx.guildLocales.get(player.guildId);
    const t = (key: string, vars?: Record<string, string | number>) => this.ctx.i18n.t(locale, key, vars);
    try {
      const message: Message = await channel.send(nowPlayingMessage(t, player, track));
      player.setData(NOW_PLAYING_KEY, message.id);
    } catch (err) {
      this.ctx.logger.debug({ err, guildId: player.guildId }, 'Now playing message not sent');
    }
  }

  /** Removes the previous "now playing" message, so the channel keeps only the current one. */
  private async clearNowPlaying(player: Player): Promise<void> {
    const messageId = player.getData<string | undefined>(NOW_PLAYING_KEY);
    if (!messageId) return;
    player.deleteData(NOW_PLAYING_KEY);
    const channel = await this.textChannel(player);
    if (channel && 'messages' in channel) await channel.messages.delete(messageId).catch(() => {});
  }

  // ─── Dashboard control and restarts ─────────────────────────────────────

  /**
   * Which search sources work: a connected node has their source managers and a search answers without an error (bad
   * credentials, a region block). One cluster checks a round; a node connecting or dropping is checked at once.
   */
  async checkSources(force = false): Promise<void> {
    const { redis, logger } = this.ctx;
    try {
      const locked = await redis.set(MusicKeys.sourcesLock, '1', 'PX', PROBE_INTERVAL_MS - 30_000, 'NX');
      if (!locked && !force) return;
      const requester: Requester = { id: '', username: '' };
      const working = new Set<SearchSource>();
      for (const node of this.manager.nodeManager.nodes.values()) {
        if (!node.connected || !node.info) continue;
        const untested = supportedSources(node.info.sourceManagers).filter((s) => !working.has(s));
        const passed = await Promise.all(
          untested.map(async (source) => {
            try {
              const result = await withTimeout(node.search({ query: PROBE_QUERY, source: SEARCH_PLATFORMS[source] }, requester), SEARCH_TIMEOUT_MS);
              if (result.loadType !== 'error') return source;
              logger.warn({ node: node.id, source, exception: result.exception }, 'Music source answers with an error');
            } catch (err) {
              logger.warn({ err, node: node.id, source }, 'Music source does not answer');
            }
            return null;
          }),
        );
        for (const source of passed) if (source) working.add(source);
      }
      const state: SourcesState = { sources: SearchSource.options.filter((s) => working.has(s)), checkedAt: Date.now() };
      await redis.set(MusicKeys.sources, JSON.stringify(state), 'EX', SOURCES_TTL_SEC);
    } catch (err) {
      logger.warn({ err }, 'Music sources not checked');
    }
  }

  private async onControlMessage(raw: string): Promise<void> {
    let message: ControlMessage;
    try {
      message = ControlMessage.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if (!this.getPlayer(message.guildId)) return;
    try {
      await this.control(message.guildId, message);
      this.ctx.logger.info({ guildId: message.guildId, userId: message.userId, action: message.action }, 'Player action from the dashboard');
    } catch (err) {
      this.ctx.logger.warn({ err, guildId: message.guildId, action: message.action }, 'Dashboard player action failed');
    }
  }

  private async saveForResume(player: Player): Promise<void> {
    const current = player.queue.current;
    if (!current?.encoded || !player.voiceChannelId) return;
    const snapshot: ResumeSnapshot = {
      voiceChannelId: player.voiceChannelId,
      textChannelId: player.textChannelId,
      volume: player.volume,
      repeatMode: player.repeatMode,
      paused: player.paused,
      positionMs: Math.round(player.position),
      current: current as Track,
      tracks: player.queue.tracks.filter((t): t is Track => Boolean(t.encoded)),
    };
    await this.ctx.redis.set(MusicKeys.resume(player.guildId), JSON.stringify(snapshot), 'EX', RESUME_TTL_SEC);
  }

  /** Picks up players saved by a previous run for guilds of this cluster — once, after the first node connects. */
  private async resumeSaved(): Promise<void> {
    if (this.resumed) return;
    this.resumed = true;
    const { redis, client, logger } = this.ctx;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', MusicKeys.resumePattern, 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        const guildId = key.slice(MusicKeys.resume('').length);
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        // GETDEL: exactly one cluster takes the snapshot.
        const raw = await redis.getdel(key);
        if (!raw) continue;
        try {
          await this.restore(guildId, JSON.parse(raw) as ResumeSnapshot);
        } catch (err) {
          logger.warn({ err, guildId }, 'Player not resumed');
        }
      }
    } while (cursor !== '0');
  }

  private async restore(guildId: string, snapshot: ResumeSnapshot): Promise<void> {
    if (!(await this.ctx.config.isEnabled(guildId, this.ctx.moduleId))) return;
    const channel = this.ctx.client.guilds.cache.get(guildId)?.channels.cache.get(snapshot.voiceChannelId);
    if (!channel?.isVoiceBased() || channel.members.filter((m) => !m.user.bot).size === 0) return;

    const player = this.manager.createPlayer({
      guildId,
      voiceChannelId: snapshot.voiceChannelId,
      textChannelId: snapshot.textChannelId ?? undefined,
      selfDeaf: true,
      volume: snapshot.volume,
    });
    const build = (t: Track) => this.manager.utils.buildTrack(t, t.requester);
    await player.queue.add(snapshot.tracks.map(build));
    await player.setRepeatMode(snapshot.repeatMode);
    await player.connect();
    await player.play({ clientTrack: build(snapshot.current), position: snapshot.positionMs, paused: snapshot.paused });
    this.ctx.logger.info({ guildId, tracks: snapshot.tracks.length + 1 }, 'Player resumed after restart');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
