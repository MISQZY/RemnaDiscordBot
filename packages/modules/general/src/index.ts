import { defineModule } from '@bot/core';
import { help } from './commands/help.js';
import { language } from './commands/language.js';
import { modules } from './commands/modules.js';
import { ping } from './commands/ping.js';
import { GeneralConfig } from './config.js';
import { locales } from './locales.js';

/** Служебные команды, доступные на любом сервере. */
export default defineModule({
  id: 'general',
  configSchema: GeneralConfig,
  defaultConfig: {},
  configVersion: 1,
  alwaysEnabled: true,
  locales,
  bot: {
    commands: [ping, help, modules, language],
  },
});
