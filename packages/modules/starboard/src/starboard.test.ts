import { describe, expect, it } from 'vitest';
import { matchesEmoji, starboardBody } from './bot.js';

describe('starboard', () => {
  it('matches the board emoji, custom ones by id', () => {
    expect(matchesEmoji('⭐', { id: null, name: '⭐' })).toBe(true);
    expect(matchesEmoji('⭐', { id: null, name: '🔥' })).toBe(false);
    expect(matchesEmoji('<:pog:123>', { id: '123', name: 'pogchamp' })).toBe(true);
  });

  it('copies the text and image with a link back', () => {
    const body = starboardBody(
      { content: 'nice', url: 'https://discord.com/x', channelId: '5', createdTimestamp: 0, author: { username: 'ann', avatarURL: null }, image: 'https://cdn/i.png' },
      4,
      '⭐',
      'Jump',
    );
    expect(body.content).toBe('⭐ **4** · <#5>');
    expect(body.embeds[0]).toMatchObject({ description: 'nice', image: { url: 'https://cdn/i.png' }, fields: [{ value: '[Jump](https://discord.com/x)' }] });
  });
});
