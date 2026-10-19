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
  /** Single-use OAuth2 state → redirect path after login. */
  oauthState: (state: string) => `oauth:state:${state}`,
  /** The user's guilds from Discord — cached for a minute: the endpoint is heavily rate limited. */
  userGuilds: (userId: string) => `user:${userId}:guilds`,
  /** Lock of a worker interval task for one period. */
  intervalLock: (moduleId: string, name: string) => `lock:interval:${moduleId}:${name}`,
} as const;

export const RedisChannels = {
  configInvalidate: 'config:invalidate',
} as const;
