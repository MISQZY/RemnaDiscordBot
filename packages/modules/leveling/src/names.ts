import type { UserDirectory } from '@bot/discord';
import type { LeaderboardEntry } from './config.js';

/**
 * Entries of members the bot has no name of — XP given from the dashboard or a command before they wrote anything —
 * named from Discord (UserDirectory: Redis, otherwise REST), so a leaderboard shows a name and an avatar, not an ID.
 */
export async function withNames(
  items: LeaderboardEntry[],
  users: Pick<UserDirectory, 'resolve'>,
  options?: { fetchMissing?: boolean },
): Promise<LeaderboardEntry[]> {
  const ids = items.filter((e) => !e.username).map((e) => e.userId);
  const known = options !== undefined ? await users.resolve(ids, options) : await users.resolve(ids);
  return items.map((e) => {
    const user = e.username ? undefined : known[e.userId];
    return user ? { ...e, username: user.username, avatar: user.avatar } : e;
  });
}
