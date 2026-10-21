import type { UserDirectory } from '@bot/discord';
import type { LeaderboardEntry } from './config.js';

/**
 * Entries of members the bot has no name of — XP given from the dashboard or a command before they wrote anything —
 * named from Discord (UserDirectory: Redis, otherwise REST), so a leaderboard shows a name and an avatar, not an ID.
 */
export async function withNames(items: LeaderboardEntry[], users: Pick<UserDirectory, 'resolve'>): Promise<LeaderboardEntry[]> {
  const known = await users.resolve(items.filter((e) => !e.username).map((e) => e.userId));
  return items.map((e) => {
    const user = e.username ? undefined : known[e.userId];
    return user ? { ...e, username: user.username, avatar: user.avatar } : e;
  });
}
