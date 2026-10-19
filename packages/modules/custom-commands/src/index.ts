import { defineModule } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { customCommandsApi } from './api.js';
import { customSlashCommand, onMessage } from './bot.js';
import { CustomCommandsConfig, defaultCustomCommandsConfig } from './config.js';
import { locales } from './locales.js';

export { CommandDto, CommandInput, CustomCommandsConfig } from './config.js';

/** Пользовательские slash-команды и автоответы на сообщения. */
export default defineModule({
  id: 'custom-commands',
  configSchema: CustomCommandsConfig,
  defaultConfig: defaultCustomCommandsConfig,
  configVersion: 1,
  locales,
  bot: {
    // Триггеры читают текст сообщений — привилегированный intent Message Content.
    intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    events: { messageCreate: onMessage },
    fallbackCommand: customSlashCommand,
  },
  api: customCommandsApi,
});
