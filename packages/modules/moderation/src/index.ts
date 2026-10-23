import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { moderationApi } from './api.js';
import { commands } from './commands.js';
import { defaultModerationConfig, ModerationConfig } from './config.js';
import { unbanJob, unlockJob } from './jobs.js';
import { locales } from './locales.js';
import { contextMenus, MOD_PREFIX, moderationComponent } from './menus.js';
import { onAuditLogEntry } from './native.js';

export { ModCaseDto, ModerationConfig, SYSTEM_MODERATOR } from './config.js';
export { LockdownService } from './lockdown.js';
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
  validateConfig: (config, guild) =>
    new EntityChecker(guild)
      .textChannel(config.logChannelId, ['logChannelId'])
      .textChannel(config.reportChannelId, ['reportChannelId'])
      .role(config.reportRoleId, ['reportRoleId'])
      .channels(config.lockdown.channelIds, ['lockdown', 'channelIds']).issues,
  bot: {
    // Audit log entries (bans, kicks and timeouts done in Discord) come with Guild Moderation.
    intents: [GatewayIntentBits.GuildModeration],
    commands,
    contextMenus,
    components: { [MOD_PREFIX]: moderationComponent },
    events: { guildAuditLogEntryCreate: onAuditLogEntry },
  },
  // A temporary punishment or lockdown ends on time, whether or not the module is still on.
  jobs: { unban: { run: unbanJob, whenDisabled: 'run' }, unlock: { run: unlockJob, whenDisabled: 'run' } },
  api: moderationApi,
});
