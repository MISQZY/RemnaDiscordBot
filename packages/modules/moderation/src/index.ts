import { defineModule, EntityChecker } from '@bot/core';
import { moderationApi } from './api.js';
import { commands } from './commands.js';
import { defaultModerationConfig, ModerationConfig } from './config.js';
import { unbanJob } from './jobs.js';
import { locales } from './locales.js';

export { ModCaseDto, ModerationConfig } from './config.js';
export { ModerationService } from './service.js';

/** Баны, кики, муты, предупреждения с автоэскалацией и журналом кейсов. */
export default defineModule({
  id: 'moderation',
  configSchema: ModerationConfig,
  defaultConfig: defaultModerationConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) => new EntityChecker(guild).textChannel(config.logChannelId, ['logChannelId']).issues,
  bot: { commands },
  jobs: { unban: unbanJob },
  api: moderationApi,
});
