/** Все ключи и каналы Redis — в одном месте, чтобы API и бот не разошлись. */
export const RedisKeys = {
  moduleConfig: (guildId: string, moduleId: string) => `cfg:${guildId}:${moduleId}`,
  cooldown: (command: string, userId: string) => `cooldown:${command}:${userId}`,
  /** Снапшот гильдии; наличие `meta` означает, что бот на сервере. */
  guildMeta: (guildId: string) => `guild:${guildId}:meta`,
  guildChannels: (guildId: string) => `guild:${guildId}:channels`,
  guildRoles: (guildId: string) => `guild:${guildId}:roles`,
  guildEmojis: (guildId: string) => `guild:${guildId}:emojis`,
  clusterHeartbeat: (clusterId: number) => `bot:cluster:${clusterId}`,
  clusterHeartbeatPattern: 'bot:cluster:*',
  /** Сессия веб-платформы (API). */
  session: (sessionId: string) => `session:${sessionId}`,
  /** Одноразовый state OAuth2 → путь редиректа после входа. */
  oauthState: (state: string) => `oauth:state:${state}`,
  /** Гильдии пользователя из Discord — кэш на минуту: эндпоинт жёстко лимитирован. */
  userGuilds: (userId: string) => `user:${userId}:guilds`,
} as const;

export const RedisChannels = {
  configInvalidate: 'config:invalidate',
} as const;
