import type { Message } from 'discord.js';
import type { Player, Track } from 'lavalink-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultMusicConfig } from './config.js';
import { nowplaying, queue, runtime } from './commands.js';
import { progressBar } from './format.js';
import { MusicService } from './service.js';

afterEach(() => { runtime.service = null; vi.restoreAllMocks(); });

function fixture() {
  const data = new Map<string, unknown>();
  const track = { info: { title: 'Song', author: 'Artist', duration: 100_000, isStream: false }, pluginInfo: {} };
  const player = {
    guildId: 'guild', voiceChannelId: 'voice', textChannelId: 'text',
    position: 0, paused: false, volume: 80, repeatMode: 'off',
    queue: { current: track, previous: [], tracks: [], utils: { totalDuration: () => 100_000 } },
    getData: (key: string) => data.get(key),
    setData: (key: string, value: unknown) => data.set(key, value),
    deleteData: (key: string) => data.delete(key),
    destroy: vi.fn(async () => {}),
  };
  const message = { id: 'message', edit: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
  const channel = { id: 'text', isSendable: () => true, send: vi.fn(async () => message), messages: { delete: vi.fn(async () => {}) } };
  const ctx = {
    client: { user: { id: 'bot' }, guilds: { cache: new Map() }, channels: { fetch: vi.fn(async () => channel) } },
    getConfig: vi.fn(async () => ({ ...defaultMusicConfig, announceTracks: true })),
    guildLocales: { get: vi.fn(async () => 'en') },
    i18n: { t: (_locale: string, key: string) => key },
    logger: { debug: vi.fn() }, redis: { del: vi.fn(async () => 1) },
  };
  const service = new MusicService(ctx as never, []);
  let current: unknown = player;
  vi.spyOn(service.manager, 'getPlayer').mockImplementation(() => current as Player);
  const internal = service as unknown as {
    announce(player: unknown, track: unknown): Promise<void>;
    refreshNowPlaying(player: unknown, force?: boolean): Promise<void>;
    clearSessionMessages(player: unknown): Promise<void>;
  };
  return { service, internal, player, track, data, message, channel, ctx, disconnect: () => { current = undefined; } };
}

describe('now playing updates', () => {
  it('moves the compact marker using current playback time, throttling REST edits without fetching the message', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const f = fixture();
    await f.internal.announce(f.player, f.track);
    f.player.position = 50_000;
    await f.internal.refreshNowPlaying(f.player);
    expect(f.message.edit).not.toHaveBeenCalled();
    clock.mockReturnValue(110_000);
    await f.internal.refreshNowPlaying(f.player);
    const payload = f.message.edit.mock.calls[0] as unknown as [{ embeds: { toJSON(): { description: string } }[] }];
    expect(payload[0].embeds[0]!.toJSON().description).toContain(`${progressBar(50_000, 100_000)} 0:50 / 1:40`);
    expect([...progressBar(50_000, 100_000)]).toHaveLength(8);
    clock.mockReturnValue(120_000);
    await f.internal.refreshNowPlaying(f.player);
    expect(f.message.edit).toHaveBeenCalledTimes(1);
    expect(f.ctx.client.channels.fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes controls immediately and skips periodic updates for paused players and streams', async () => {
    const f = fixture();
    await f.internal.announce(f.player, f.track);
    f.player.paused = true;
    await f.internal.refreshNowPlaying(f.player);
    expect(f.message.edit).not.toHaveBeenCalled();
    await f.internal.refreshNowPlaying(f.player, true);
    expect(f.message.edit).toHaveBeenCalledTimes(1);
    f.player.position = 75_000;
    await f.internal.refreshNowPlaying(f.player);
    expect(f.message.edit).toHaveBeenCalledTimes(1);
    f.player.paused = false;
    f.track.info.isStream = true;
    await f.internal.refreshNowPlaying(f.player);
    expect(f.message.edit).toHaveBeenCalledTimes(1);
  });

  it('serializes in-flight edits and retains a control change received while an edit is pending', async () => {
    const f = fixture();
    await f.internal.announce(f.player, f.track);
    let finish!: () => void;
    f.message.edit.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    f.player.position = 30_000;
    const pending = f.internal.refreshNowPlaying(f.player, true);
    f.player.paused = true;
    await f.internal.refreshNowPlaying(f.player, true);
    expect(f.message.edit).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    await vi.waitFor(() => expect(f.message.edit).toHaveBeenCalledTimes(2));
  });

  it('stops refreshing deleted messages', async () => {
    const f = fixture();
    await f.internal.announce(f.player, f.track);
    f.message.edit.mockRejectedValueOnce({ code: 10008 });
    f.player.position = 30_000;
    await f.internal.refreshNowPlaying(f.player, true);
    f.player.position = 60_000;
    await f.internal.refreshNowPlaying(f.player, true);
    expect(f.message.edit).toHaveBeenCalledTimes(1);
  });

  it('deletes an announcement that finishes sending after the session ends', async () => {
    const f = fixture();
    f.channel.send.mockImplementationOnce(async () => { f.disconnect(); return f.message; });
    await f.internal.announce(f.player, f.track as Track);
    expect(f.message.delete).toHaveBeenCalledOnce();
    expect(f.data.has('nowPlaying')).toBe(false);
  });
});

describe('music session cleanup', () => {
  it.each([queue, nowplaying])('records the public $data.name command reply for cleanup', async (command) => {
    const f = fixture();
    runtime.service = f.service;
    vi.spyOn(f.service, 'available', 'get').mockReturnValue(true);
    const interaction = {
      guildId: 'guild', options: { getInteger: () => null },
      reply: vi.fn(async () => ({ resource: { message: f.message } })),
    };
    await command.execute(interaction as never, { tGuild: (key: string) => key } as never);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ withResponse: true }));
    await f.internal.clearSessionMessages(f.player);
    expect(f.message.delete).toHaveBeenCalledOnce();
  });

  it('removes all recorded replies and the player embed when the player is destroyed', async () => {
    const f = fixture();
    await f.internal.announce(f.player, f.track);
    const queue = { delete: vi.fn(async () => {}) };
    await f.service.trackSessionMessage(f.player as unknown as Player, queue as unknown as Message);
    f.disconnect();
    f.service.manager.emit('playerDestroy', f.player as unknown as Player, 'Disconnected');
    await vi.waitFor(() => expect(f.message.delete).toHaveBeenCalledOnce());
    expect(queue.delete).toHaveBeenCalledOnce();
    await f.internal.refreshNowPlaying(f.player, true);
    expect(f.message.edit).not.toHaveBeenCalled();
  });

  it('deletes late replies from a closed session without attaching them to its replacement', async () => {
    const f = fixture();
    await f.internal.clearSessionMessages(f.player);
    const late = { delete: vi.fn(async () => {}) };
    await f.service.trackSessionMessage(f.player as unknown as Player, late as unknown as Message);
    expect(late.delete).toHaveBeenCalledOnce();
  });

  it('bounds concurrent deletes and continues past messages that were already deleted', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maxActive = 0;
    const messages = Array.from({ length: 12 }, (_, index) => ({ delete: vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
      if (index === 0) throw new Error('Unknown Message');
    }) }));
    for (const message of messages) await f.service.trackSessionMessage(f.player as unknown as Player, message as unknown as Message);
    const cleanup = f.internal.clearSessionMessages(f.player);
    expect(active).toBe(5);
    release();
    await cleanup;
    expect(maxActive).toBe(5);
    for (const message of messages) expect(message.delete).toHaveBeenCalledOnce();
  });

  it('ends playback when the bot is removed from voice, without reconnecting', async () => {
    const f = fixture();
    await f.service.onVoiceStateUpdate({ channelId: 'voice' } as never,
      { id: 'bot', channelId: null, guild: { id: 'guild' } } as never);
    expect(f.player.destroy).toHaveBeenCalledWith('Disconnected');
    expect(f.service.manager.options.playerOptions?.onDisconnect).toMatchObject({ autoReconnect: false, destroyPlayer: true });
  });
});
