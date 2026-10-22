/** All Redis keys and channels in one place so the API and the bot don't drift apart. */
export const RedisKeys = {
  moduleConfig: (guildId: string, moduleId: string) => `cfg:${guildId}:${moduleId}`,
  cooldown: (command: string, userId: string) => `cooldown:${command}:${userId}`,
  /** Guild snapshot; the presence of `meta` means the bot is on the server. */
  guildMeta: (guildId: string) => `guild:${guildId}:meta`,
  guildChannels: (guildId: string) => `guild:${guildId}:channels`,
  guildRoles: (guildId: string) => `guild:${guildId}:roles`,
  guildEmojis: (guildId: string) => `guild:${guildId}:emojis`,
  clusterHeartbeat: (clusterId: number) => `bot:cluster:${clusterId}`,
  clusterHeartbeatPattern: 'bot:cluster:*',
  /** Web platform session (API). */
  session: (sessionId: string) => `session:${sessionId}`,
  /** Single-use OAuth2 state → where to go after login. */
  oauthState: (state: string) => `oauth:state:${state}`,
  /** Single-use login code of an external client → the session it is exchanged for. */
  oauthCode: (code: string) => `oauth:code:${code}`,
  /** The user's guilds from Discord — cached for a minute: the endpoint is heavily rate limited. */
  userGuilds: (userId: string) => `user:${userId}:guilds`,
  /** The last guild list Discord gave, kept longer: served while Discord refuses (rate limit, outage). */
  userGuildsLast: (userId: string) => `user:${userId}:guilds:last`,
  /** A Discord user's name and avatar — for the dashboard, which knows users only by ID. */
  user: (userId: string) => `user:${userId}:profile`,
  /** Lock of a worker interval task for one period. */
  intervalLock: (moduleId: string, name: string) => `lock:interval:${moduleId}:${name}`,
  /** Lease of a running interval task, renewed while it runs — no second run starts before it ends. */
  intervalRun: (moduleId: string, name: string) => `lock:interval-run:${moduleId}:${name}`,
} as const;

export const RedisChannels = {
  configInvalidate: 'config:invalidate',
} as const;
