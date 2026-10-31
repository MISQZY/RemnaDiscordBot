import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ephemeralReply } from './reply.js';

describe('ephemeralReply', () => {
  it('replies ephemerally with suppressed mentions', async () => {
    const reply = vi.fn(async () => {});
    await ephemeralReply({ reply }, 'Hello world');

    expect(reply).toHaveBeenCalledWith({
      content: 'Hello world',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('preserves extra reply options', async () => {
    const reply = vi.fn(async () => {});
    await ephemeralReply({ reply }, 'With embeds', { embeds: [{ title: 'Test' }] });

    expect(reply).toHaveBeenCalledWith({
      content: 'With embeds',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
      embeds: [{ title: 'Test' }],
    });
  });
});
