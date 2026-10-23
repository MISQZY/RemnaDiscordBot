import type { REST } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { forumTagIds } from './forum.js';

const restWith = (channel: object) => ({ get: async () => channel }) as unknown as REST;

describe('forumTagIds', () => {
  it('finds the forum tags by name, case and spaces aside', async () => {
    const forum = restWith({ type: 15, available_tags: [{ id: '1', name: 'Открыт' }, { id: '2', name: ' закрыт ' }] });
    expect(await forumTagIds(forum, 'f', ['закрыт', 'Нет такого', 'ОТКРЫТ'])).toEqual(['2', '1']);
  });

  it('tells a channel that is not a forum', async () => {
    expect(await forumTagIds(restWith({ type: 0 }), 'c', ['Открыт'])).toBeNull();
  });
});
