/** Все ключи и каналы Redis — в одном месте, чтобы API и бот не разошлись. */
export const RedisKeys = {
  moduleConfig: (guildId: string, moduleId: string) => `cfg:${guildId}:${moduleId}`,
  cooldown: (command: string, userId: string) => `cooldown:${command}:${userId}`,
} as const;

export const RedisChannels = {
  configInvalidate: 'config:invalidate',
} as const;
