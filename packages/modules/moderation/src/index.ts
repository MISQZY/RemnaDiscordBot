import { defineModule, EntityChecker } from '@bot/core';
import { moderationApi } from './api.js';
import { commands } from './commands.js';
import { defaultModerationConfig, ModerationConfig } from './config.js';
import { unbanJob } from './jobs.js';
import { locales } from './locales.js';

export { ModCaseDto, ModerationConfig } from './config.js';
export { ModerationService } from './service.js';

/** Bans, kicks, mutes, warnings with auto-escalation and a case log. */
export default defineModule({
  id: 'moderation',
  configSchema: ModerationConfig,
  defaultConfig: defaultModerationConfig,
  configVersion: 1,
  // Moderation commands are already limited by Discord permissions — no need to wait for enabling in the dashboard.
  enabledByDefault: true,
  locales,
  validateConfig: (config, guild) => new EntityChecker(guild).textChannel(config.logChannelId, ['logChannelId']).issues,
  bot: { commands },
  jobs: { unban: unbanJob },
  api: moderationApi,
});
