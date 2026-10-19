import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits, Partials } from 'discord.js';
import { AuditLogConfig, defaultAuditLogConfig, LogCategory } from './config.js';
import { createHandlers } from './handlers.js';
import { locales } from './locales.js';

export { AuditLogConfig } from './config.js';

/** Журнал событий сервера в выбранные каналы: сообщения, участники, голос, сервер, баны. */
export default defineModule({
  id: 'audit-log',
  configSchema: AuditLogConfig,
  defaultConfig: defaultAuditLogConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) => {
    const checker = new EntityChecker(guild).channels(config.ignoredChannelIds, ['ignoredChannelIds']).roles(config.ignoredRoleIds, ['ignoredRoleIds']);
    for (const category of LogCategory.options) checker.textChannel(config.channels[category], ['channels', category]);
    return checker.issues;
  },
  bot: {
    intents: [
      GatewayIntentBits.GuildMessages,
      // Текст сообщений — привилегированный intent Message Content.
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildModeration,
    ],
    // Бот не кэширует сообщения и не всех участников — события по ним приходят как partial.
    partials: [Partials.Message, Partials.GuildMember, Partials.User],
    events: createHandlers(),
  },
});
