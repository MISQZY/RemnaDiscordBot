import { describe, expect, it } from 'vitest';
import { isFinal, suggestionMessage } from './service.js';

const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ''}`;
const row = { id: 's1', number: 3, authorId: '1', content: 'More emoji', status: 'pending', reviewerId: null, response: null, upvotes: 4, downvotes: 1 };

describe('suggestions', () => {
  it('shows votes on the buttons and hides the author when anonymous', () => {
    const message = suggestionMessage(t, row, { anonymous: false });
    expect(message.components[0]!.components.map((b) => [b.custom_id, b.label, b.disabled])).toEqual([
      ['sg:up:s1', '4', false],
      ['sg:down:s1', '1', false],
    ]);
    expect(message.embeds[0]!.fields!.map((f) => f.name)).toContain('suggestions.embed.author');
    expect(suggestionMessage(t, row, { anonymous: true }).embeds[0]!.fields!.map((f) => f.name)).not.toContain('suggestions.embed.author');
  });

  it('closes voting on a final decision only', () => {
    expect(isFinal('considered')).toBe(false);
    expect(isFinal('approved')).toBe(true);
    expect(suggestionMessage(t, { ...row, status: 'denied', reviewerId: '2', response: 'No' }, { anonymous: false }).components[0]!.components[0]!.disabled).toBe(true);
  });
});
