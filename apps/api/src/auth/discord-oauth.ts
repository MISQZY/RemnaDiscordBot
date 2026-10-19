import { ApiError } from '../errors.js';

const DISCORD_API = 'https://discord.com/api/v10';
export const OAUTH_SCOPES = ['identify', 'guilds'] as const;

export interface DiscordTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token expiry as Unix time, ms. */
  expiresAt: number;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordPartialGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  /** The user's permission bitmask in the guild (bigint as a string). */
  permissions: string;
}

/** Discord calls on behalf of the user. Replaced with a fake in tests. */
export interface DiscordOAuth {
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<DiscordTokens>;
  refresh(refreshToken: string): Promise<DiscordTokens>;
  revoke(token: string): Promise<void>;
  getUser(accessToken: string): Promise<DiscordUser>;
  getGuilds(accessToken: string): Promise<DiscordPartialGuild[]>;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class HttpDiscordOAuth implements DiscordOAuth {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: OAUTH_SCOPES.join(' '),
      redirect_uri: redirectUri,
      state,
      prompt: 'none',
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<DiscordTokens> {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  async refresh(refreshToken: string): Promise<DiscordTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(token: string): Promise<void> {
    await this.request('/oauth2/token/revoke', { method: 'POST', body: this.form({ token }) });
  }

  getUser(accessToken: string): Promise<DiscordUser> {
    return this.request('/users/@me', { headers: { authorization: `Bearer ${accessToken}` } });
  }

  getGuilds(accessToken: string): Promise<DiscordPartialGuild[]> {
    return this.request('/users/@me/guilds', { headers: { authorization: `Bearer ${accessToken}` } });
  }

  private async token(params: Record<string, string>): Promise<DiscordTokens> {
    const body = await this.request<TokenResponse>('/oauth2/token', { method: 'POST', body: this.form(params) });
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
  }

  private form(params: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...params });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${DISCORD_API}${path}`, init);
    if (response.status === 401 || response.status === 400) {
      throw ApiError.unauthorized('Discord authorization failed');
    }
    if (!response.ok) throw ApiError.discordUnavailable(`Discord API responded with ${response.status}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}
