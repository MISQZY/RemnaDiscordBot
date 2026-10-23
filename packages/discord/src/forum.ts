import { Routes, type APIGuildForumChannel, type REST } from 'discord.js';

/** discord.js channel type of a forum. */
export const FORUM_CHANNEL_TYPE = 15;

/**
 * Ids of the forum's tags named `names` (case and spaces aside), in that order. The bot marks a post's state with the
 * forum's own tags: a server that wants them adds tags with these names, one without them gets no tags. `null` — the
 * channel is not a forum.
 */
export async function forumTagIds(rest: REST, forumId: string, names: readonly string[]): Promise<string[] | null> {
  const forum = (await rest.get(Routes.channel(forumId))) as Pick<APIGuildForumChannel, 'type' | 'available_tags'>;
  if (forum.type !== FORUM_CHANNEL_TYPE) return null;
  const norm = (name: string) => name.trim().toLocaleLowerCase();
  const byName = new Map((forum.available_tags ?? []).map((tag) => [norm(tag.name), tag.id]));
  return names.flatMap((name) => byName.get(norm(name)) ?? []);
}
