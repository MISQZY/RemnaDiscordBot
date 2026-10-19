import { defineModule } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { customCommandsApi } from './api.js';
import { customSlashCommand, onMessage } from './bot.js';
import { CustomCommandsConfig, defaultCustomCommandsConfig } from './config.js';
import { locales } from './locales.js';

export { CommandDto, CommandInput, CustomCommandsConfig } from './config.js';

/** Custom slash commands and auto-replies to messages. */
export default defineModule({
  id: 'custom-commands',
  configSchema: CustomCommandsConfig,
  defaultConfig: defaultCustomCommandsConfig,
  configVersion: 1,
  locales,
  bot: {
    // Triggers read message text — the privileged Message Content intent.
    intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    events: { messageCreate: onMessage },
    fallbackCommand: customSlashCommand,
  },
  api: customCommandsApi,
});
