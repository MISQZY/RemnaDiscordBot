import type { CoreServices, ModuleRegistry } from '@bot/core';
import type { GuildSnapshotReader } from '@bot/discord';
import type { DiscordOAuth } from './auth/discord-oauth.js';
import type { LinkClient } from './auth/link-clients.js';

/** Everything the server depends on; built in index.ts, in tests from SQLite, a Redis mock and a fake Discord. */
export interface ApiDeps extends CoreServices {
  registry: ModuleRegistry;
  snapshots: GuildSnapshotReader;
  oauth: DiscordOAuth;
  options: ApiOptions;
}

export interface ApiOptions {
  publicUrl: string;
  /** Web app URL: CORS and post-login redirect. */
  webOrigin: string;
  /** Where to go after login when the web app did not pass a path. */
  defaultRedirect: string;
  clientId: string;
  /** Cookie signing and token encryption key. */
  sessionSecret: string;
  secureCookies: boolean;
  /** Swagger UI at `/docs`. */
  docs: boolean;
  /** External dashboards that sign users in through the API and call it with bearer tokens. */
  linkClients: LinkClient[];
  /** Global request limit per minute per user/IP; 0 — unlimited. */
  rateLimitPerMinute: number;
}
