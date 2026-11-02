import { localizeCommand, ModuleRegistry } from '@bot/core';
import { I18n } from '@bot/i18n';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { canControl } from './commands.js';
import { defaultMusicConfig, type MusicConfig } from './config.js';
import { escapeTitle, formatDuration, parseLavalinkNodes, parseTimestamp, progressBar } from './format.js';
import music from './index.js';
import { announceChannelId, nextRepeatMode, playerButtons, publicPlayerUrl } from './messages.js';
import { MusicService } from './service.js';
import { supportedSources } from './sources.js';
import { ControlMessage, MusicKeys } from './state.js';
import { cleanMusicQuery, playableQuery, requesterOf, trackView } from './tracks.js';

const GUILD = '111111111111111111';
const USER = '222222222222222222';
const DJ_ROLE = '333333333333333333';

describe('formatting', () => {
  it('formats durations and parses timestamps', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(187_000)).toBe('3:07');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(parseTimestamp('1:30')).toBe(90_000);
    expect(parseTimestamp('90')).toBe(90_000);
    expect(parseTimestamp('1:02:03')).toBe(3_723_000);
    expect(parseTimestamp('1:x')).toBeNull();
    expect(parseTimestamp('1:2:3:4')).toBeNull();
  });

  it('draws a progress bar of a fixed width', () => {
    expect(progressBar(0, 100, 10)).toBe('🔘▬▬▬▬▬▬▬▬▬');
    expect(progressBar(100, 100, 10)).toBe('▬▬▬▬▬▬▬▬▬🔘');
    expect([...progressBar(50, 100, 10).replace('🔘', '*')]).toHaveLength(10);
  });

  it('strips markdown that would break a link title', () => {
    expect(escapeTitle('[Live] Song (Remix) *new*')).toBe('Live Song Remix new');
    expect(escapeTitle('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('LAVALINK_NODES', () => {
  it('parses nodes with passwords and TLS', () => {
    expect(parseLavalinkNodes(undefined)).toEqual([]);
    const [plain, tls] = parseLavalinkNodes('lavalink://secret%40pass@lavalink:2333, lavalinks://pw@audio.example.com');
    expect(plain).toMatchObject({ id: 'lavalink:2333', host: 'lavalink', port: 2333, secure: false, authorization: 'secret@pass' });
    expect(tls).toMatchObject({ host: 'audio.example.com', port: 443, secure: true, authorization: 'pw' });
  });

  it('rejects other schemes', () => {
    expect(() => parseLavalinkNodes('http://pw@host:2333')).toThrow(/lavalink:\/\//);
  });
});

describe('search sources', () => {
  it('does not advertise empty searches, errors or sources on disconnected nodes', async () => {
    const set = vi.fn(async () => 'OK');
    const service = Object.create(MusicService.prototype) as MusicService;
    Object.assign(service, {
      checkingSources: null,
      ctx: { redis: { set }, logger: { warn: vi.fn() } },
      manager: { nodeManager: { nodes: new Map([
        ['online', { id: 'online', connected: true, info: { sourceManagers: ['youtube', 'soundcloud', 'bandcamp'] },
          search: vi.fn(async ({ source }: { source: string }) => source === 'ytsearch' || source === 'ytmsearch'
            ? { loadType: 'search', tracks: [{}] }
            : { loadType: source === 'bcsearch' ? 'error' : 'empty', tracks: [] }) }],
        ['offline', { connected: false, info: { sourceManagers: ['deezer'] }, search: vi.fn() }],
      ]) } },
    });
    await Promise.all([service.checkSources(), service.checkSources()]);
    const published = set.mock.calls.find((call: unknown[]) => call[0] === MusicKeys.sources) as unknown as [string, string];
    expect(JSON.parse(published[1]).sources).toEqual(['youtube', 'youtubemusic']);
    expect(set).toHaveBeenCalledTimes(2);
  });
  it('offers only sources whose source managers the node has', () => {
    expect(supportedSources(['soundcloud', 'bandcamp', 'http'])).toEqual(['soundcloud', 'bandcamp']);
    expect(supportedSources(['youtube', 'spotify', 'yandexmusic'])).toEqual(['youtube', 'youtubemusic', 'spotify', 'yandexmusic']);
  });

  it('needs YouTube for Spotify, which plays from YouTube Music', () => {
    expect(supportedSources(['spotify', 'deezer'])).toEqual(['deezer']);
  });
});

function member({ manager = false, roles = [] as string[], channelId = 'vc', listeners = 2 } = {}) {
  return {
    permissions: { has: (flag: bigint) => manager && flag === PermissionFlagsBits.ManageGuild },
    roles: { cache: new Map(roles.map((id) => [id, {}])) },
    voice: { channel: { id: channelId, members: { filter: () => ({ size: listeners }) } } },
  } as never;
}

describe('DJ roles', () => {
  const config: MusicConfig = { ...defaultMusicConfig, djRoleIds: [DJ_ROLE] };
  const player = { voiceChannelId: 'vc' } as never;

  it('lets everyone control without DJ roles', () => {
    expect(canControl(member(), defaultMusicConfig, player)).toBe(true);
  });

  it('lets DJs, managers and a lone listener control', () => {
    expect(canControl(member(), config, player)).toBe(false);
    expect(canControl(member({ roles: [DJ_ROLE] }), config, player)).toBe(true);
    expect(canControl(member({ manager: true }), config, player)).toBe(true);
    expect(canControl(member({ listeners: 1 }), config, player)).toBe(true);
    expect(canControl(member({ listeners: 1, channelId: 'other' }), config, player)).toBe(false);
  });
});

describe('tracks and control messages', () => {
  const track = {
    info: { title: 'Song', author: 'Band', uri: 'https://soundcloud.com/x', artworkUrl: null, duration: 1000, isStream: false },
    requester: { id: USER, username: 'user' },
    pluginInfo: {},
  } as never;

  it('keeps the requester and a dashboard view of a track', () => {
    expect(requesterOf(track)).toEqual({ id: USER, username: 'user' });
    expect(requesterOf(null)).toBeNull();
    expect(trackView(track)).toEqual({
      title: 'Song',
      author: 'Band',
      uri: 'https://soundcloud.com/x',
      artworkUrl: null,
      durationMs: 1000,
      isStream: false,
      requesterId: USER,
    });
  });

  it('cycles the repeat button', () => {
    expect(nextRepeatMode('off')).toBe('queue');
    expect(nextRepeatMode('queue')).toBe('track');
    expect(nextRepeatMode('track')).toBe('off');
  });

  it('validates dashboard actions', () => {
    expect(ControlMessage.safeParse({ guildId: GUILD, userId: USER, action: 'volume', value: 50 }).success).toBe(true);
    expect(ControlMessage.safeParse({ guildId: GUILD, userId: USER, action: 'volume', value: 500 }).success).toBe(false);
    expect(ControlMessage.safeParse({ guildId: GUILD, userId: USER, action: 'explode' }).success).toBe(false);
  });
});

describe('MusicService.control', () => {
  function fakePlayer() {
    return {
      guildId: GUILD,
      voiceChannelId: 'vc',
      textChannelId: null,
      paused: false,
      volume: 80,
      repeatMode: 'off',
      position: 0,
      queue: {
        current: { info: { title: 'Now', isSeekable: true, duration: 60_000 }, pluginInfo: {} },
        tracks: [{ info: { title: 'A' } }, { info: { title: 'B' } }],
        previous: [],
        shuffle: vi.fn(async () => 2),
        remove: vi.fn(async () => null),
        add: vi.fn(async () => {}),
        shiftPrevious: vi.fn(async () => null),
      },
      pause: vi.fn(async () => {}),
      resume: vi.fn(async () => {}),
      skip: vi.fn(async () => {}),
      seek: vi.fn(async () => {}),
      setVolume: vi.fn(async () => {}),
      setRepeatMode: vi.fn(async () => {}),
      destroy: vi.fn(async () => {}),
      play: vi.fn(async () => {}),
    };
  }

  function service(player: ReturnType<typeof fakePlayer> | undefined) {
    const s = Object.create(MusicService.prototype) as MusicService;
    Object.assign(s, {
      operations: new Map(),
      publications: new Map(),
      ctx: { redis: { set: vi.fn(async () => 'OK') }, logger: { debug: vi.fn() } },
      manager: { getPlayer: () => player },
    });
    return s;
  }

  it('does nothing without a player', async () => {
    expect(await service(undefined).control(GUILD, { action: 'skip' })).toBe(false);
  });

  it('disables previous without playback history even when the upcoming queue is populated', () => {
    const player = fakePlayer();
    const s = service(player);
    expect(player.queue.tracks).toHaveLength(2);
    expect(s.stateOf(player as never).hasPrevious).toBe(false);
    expect(playerButtons(player as never).toJSON().components[0]).toMatchObject({ custom_id: 'music:previous', disabled: true });
    player.queue.previous.push({} as never);
    expect(s.stateOf(player as never).hasPrevious).toBe(true);
    expect(playerButtons(player as never).toJSON().components[0]).toMatchObject({ disabled: false });
  });

  it('steers the player and publishes its state', async () => {
    const player = fakePlayer();
    const s = service(player);
    expect(await s.control(GUILD, { action: 'pause' })).toBe(true);
    expect(player.pause).toHaveBeenCalled();
    expect(await s.control(GUILD, { action: 'resume' })).toBe(false);
    expect(await s.control(GUILD, { action: 'seek', value: 120_000 })).toBe(true);
    expect(player.seek).toHaveBeenCalledWith(60_000);
    expect(await s.control(GUILD, { action: 'remove', value: 3 })).toBe(false);
    expect(await s.control(GUILD, { action: 'remove', value: 2 })).toBe(true);
    expect(player.queue.remove).toHaveBeenCalledWith(1);
    expect(await s.control(GUILD, { action: 'previous' })).toBe(false);
    expect((s as unknown as { ctx: { redis: { set: ReturnType<typeof vi.fn> } } }).ctx.redis.set).toHaveBeenCalled();
  });

  it('serializes simultaneous controls so a slow action cannot overtake the next one', async () => {
    const player = fakePlayer();
    const s = service(player);
    let release!: () => void;
    player.pause.mockImplementation(async () => { await new Promise<void>((resolve) => { release = resolve; }); });
    const paused = s.control(GUILD, { action: 'pause' });
    const volume = s.control(GUILD, { action: 'volume', value: 50 });
    await vi.waitFor(() => expect(player.pause).toHaveBeenCalled());
    expect(player.setVolume).not.toHaveBeenCalled();
    release();
    await Promise.all([paused, volume]);
    expect(player.setVolume).toHaveBeenCalledWith(50);
  });

  it('keeps controls responsive during provider searches and does not destroy playback on empty results', async () => {
    const player = fakePlayer();
    let finishSearch!: (result: { loadType: string; tracks: unknown[] }) => void;
    const search = vi.fn(() => new Promise<{ loadType: string; tracks: unknown[] }>((resolve) => { finishSearch = resolve; }));
    Object.assign(player, { node: { search } });
    const s = service(player);
    const pending = s.enqueue({ id: USER, user: { username: 'listener' }, guild: { id: GUILD } } as never,
      { id: 'vc' } as never, 'text', 'song', defaultMusicConfig);
    expect(await s.control(GUILD, { action: 'volume', value: 40 })).toBe(true);
    expect(player.setVolume).toHaveBeenCalledWith(40);
    finishSearch({ loadType: 'empty', tracks: [] });
    expect(await pending).toEqual({ kind: 'empty' });
    expect(player.destroy).not.toHaveBeenCalled();
  });
});

describe('public player link', () => {
  it('uses the web origin without leaking renderer paths, query strings or credentials', () => {
    expect(publicPlayerUrl(GUILD, { MUSIC_PLAYER_URL: 'https://web.example/path?q=x' })).toBe(`https://web.example/discord/player/${GUILD}`);
    expect(publicPlayerUrl(GUILD, { RANK_CARD_URL: 'https://web.example/api/discord/cards/rank' })).toBe(`https://web.example/discord/player/${GUILD}`);
    expect(publicPlayerUrl(GUILD, { LINK_CLIENTS: 'web:secret:https://web.example/api/discord/link/callback' })).toBe(`https://web.example/discord/player/${GUILD}`);
    expect(publicPlayerUrl(GUILD, { MUSIC_PLAYER_URL: 'https://secret@web.example' })).toBeNull();
    expect(publicPlayerUrl(GUILD, {})).toBeNull();
  });
});

describe('music module', () => {
  it('registers its commands with localized texts', () => {
    const registry = new ModuleRegistry([music]);
    const i18n = new I18n('ru');
    registry.registerLocales(i18n);
    for (const name of ['play', 'skip', 'stop', 'pause', 'queue', 'nowplaying', 'volume', 'loop', 'shuffle', 'remove', 'seek']) {
      const entry = registry.findCommand(name);
      expect(entry?.module.id).toBe('music');
      expect(localizeCommand(entry!.item.data.toJSON(), i18n, 'music').description_localizations?.ru).toBeTruthy();
    }
    expect(i18n.t('ru', 'music.nowPlaying.queue', { count: 3 })).toBe('В очереди 3 трека');
  });

  it('checks DJ roles and voice channels against the guild', () => {
    const issues = music.validateConfig!(
      { ...defaultMusicConfig, djRoleIds: [DJ_ROLE], allowedVoiceChannelIds: ['444444444444444444'] },
      { channels: [], roles: [] } as never,
    );
    expect(issues.map((i) => i.path[0])).toEqual(['djRoleIds', 'allowedVoiceChannelIds']);
  });

  it('checks the announcement channel only when it is chosen', () => {
    const guild = { channels: [], roles: [] } as never;
    const channel = '555555555555555555';
    expect(music.validateConfig!({ ...defaultMusicConfig, announceTarget: 'voice', announceChannelId: channel }, guild)).toEqual([]);
    const issues = music.validateConfig!({ ...defaultMusicConfig, announceTarget: 'channel', announceChannelId: channel }, guild);
    expect(issues.map((i) => i.path[0])).toEqual(['announceChannelId']);
  });

  it('reads configs saved before the announcement target as the command channel', () => {
    const { announceTarget: _target, announceChannelId: _channel, ...saved } = defaultMusicConfig;
    expect(music.configSchema.parse(saved)).toMatchObject({ announceTarget: 'command', announceChannelId: null });
  });
});

describe('announcement channel', () => {
  const player = { textChannelId: '1', voiceChannelId: '2' };

  it('follows the target', () => {
    expect(announceChannelId({ ...defaultMusicConfig, announceTarget: 'command' }, player)).toBe('1');
    expect(announceChannelId({ ...defaultMusicConfig, announceTarget: 'voice' }, player)).toBe('2');
    expect(announceChannelId({ ...defaultMusicConfig, announceTarget: 'channel', announceChannelId: '3' }, player)).toBe('3');
    expect(announceChannelId({ ...defaultMusicConfig, announceTarget: 'channel' }, player)).toBeNull();
  });
});

describe('playableQuery', () => {
  it('lets search text and public links through', () => {
    expect(playableQuery('never gonna give you up')).toBe(true);
    expect(playableQuery('https://soundcloud.com/artist/track')).toBe(true);
    expect(playableQuery('https://cdn.example.com/song.mp3')).toBe(false);
    expect(playableQuery('http://93.184.216.34/a.mp3')).toBe(false);
  });

  it('refuses links into the stack or a private network', () => {
    for (const url of [
      'http://api:3000/v1/guilds', 'http://redis:6379', 'http://localhost/x', 'http://127.0.0.1:2333/version',
      'http://2130706433/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/a.mp3', 'http://192.168.1.1/',
      'http://172.20.0.3/', 'http://[::1]/', 'http://[fd00::1]/', 'http://printer.local/', 'file:///etc/passwd',
      'ftp://example.com/a.mp3', 'https://user:pass@example.com/a.mp3',
      'https://localtest.me/a.mp3', 'https://attacker.example/a.mp3',
      'https://soundcloud.com.evil.test/a', 'https://soundcloud.com:2333/a',
      '//api:3000/v1/guilds',
    ]) {
      expect(playableQuery(url), url).toBe(false);
    }
  });
});

describe('cleanMusicQuery', () => {
  it('leaves plain search text untouched', () => {
    expect(cleanMusicQuery('never gonna give you up')).toBe('never gonna give you up');
  });

  it('strips auto-generated YouTube Mix / Radio (RD...) playlists from video links', () => {
    expect(
      cleanMusicQuery('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ&start_radio=1'),
    ).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(
      cleanMusicQuery('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ'),
    ).toBe('https://music.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(
      cleanMusicQuery('https://youtu.be/dQw4w9WgXcQ?list=RDdQw4w9WgXcQ&si=tracking'),
    ).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('strips regular playlists from video links unless allowPlaylist is true', () => {
    const videoWithPlaylist = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrEnWoR732-BHrPp_QLgkCoOW32JarNT5&index=3';
    expect(cleanMusicQuery(videoWithPlaylist)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(cleanMusicQuery(videoWithPlaylist, { allowPlaylist: false })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(cleanMusicQuery(videoWithPlaylist, { allowPlaylist: true })).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrEnWoR732-BHrPp_QLgkCoOW32JarNT5',
    );
  });

  it('preserves pure playlist links', () => {
    const purePlaylist = 'https://www.youtube.com/playlist?list=PLrEnWoR732-BHrPp_QLgkCoOW32JarNT5';
    expect(cleanMusicQuery(purePlaylist)).toBe(purePlaylist);
    expect(cleanMusicQuery(purePlaylist, { allowPlaylist: false })).toBe(purePlaylist);
  });

  it('cleans tracking parameters from Spotify and SoundCloud set links', () => {
    expect(cleanMusicQuery('https://open.spotify.com/track/123?si=abc456')).toBe('https://open.spotify.com/track/123');
    expect(cleanMusicQuery('https://soundcloud.com/artist/song?in=artist/sets/album')).toBe('https://soundcloud.com/artist/song');
    expect(cleanMusicQuery('https://soundcloud.com/artist/song?in=artist/sets/album', { allowPlaylist: true })).toBe(
      'https://soundcloud.com/artist/song?in=artist/sets/album',
    );
  });
});
