import type { DiscordOAuth, DiscordPartialGuild, DiscordTokens, DiscordUser } from '../auth/discord-oauth.js';
import { ApiError } from '../errors.js';

export const TEST_USER: DiscordUser = {
  id: '100000000000000001',
  username: 'tester',
  global_name: 'Tester',
  avatar: null,
};

/** Discord without network: the `valid-code` code is exchanged for tokens, guilds are set by the test. */
export class FakeDiscordOAuth implements DiscordOAuth {
  guilds: DiscordPartialGuild[] = [];
  user: DiscordUser = TEST_USER;
  guildRequests = 0;
  refreshed = 0;
  revoked: string[] = [];
  /** How soon an issued token expires. */
  tokenLifetimeMs = 60 * 60_000;

  authorizeUrl(state: string, redirectUri: string): string {
    return `https://discord.test/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  async exchangeCode(code: string): Promise<DiscordTokens> {
    if (code !== 'valid-code') throw ApiError.unauthorized('Discord authorization failed');
    return this.tokens('access-1');
  }

  async refresh(): Promise<DiscordTokens> {
    this.refreshed++;
    return this.tokens(`access-refreshed-${this.refreshed}`);
  }

  async revoke(token: string): Promise<void> {
    this.revoked.push(token);
  }

  async getUser(): Promise<DiscordUser> {
    return this.user;
  }

  async getGuilds(): Promise<DiscordPartialGuild[]> {
    this.guildRequests++;
    return this.guilds;
  }

  private tokens(accessToken: string): DiscordTokens {
    return { accessToken, refreshToken: 'refresh-1', expiresAt: Date.now() + this.tokenLifetimeMs };
  }
}
