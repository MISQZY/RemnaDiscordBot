import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { verificationApi } from './api.js';
import { onMemberJoin, onMemberLeave, verificationComponent } from './bot.js';
import { verificationCommand, verifyCommand } from './commands.js';
import { defaultVerificationConfig, VerificationConfig } from './config.js';
import { kickUnverified } from './jobs.js';
import { locales } from './locales.js';
import { PREFIX } from './service.js';

export { VerificationConfig } from './config.js';

/** A button (or a simple captcha) members press to get in: a role given, an "unverified" role taken away. */
export default defineModule({
  id: 'verification',
  configSchema: VerificationConfig,
  defaultConfig: defaultVerificationConfig,
  configVersion: 1,
  locales,
  localizeDefaults: (defaults, t) => ({ ...defaults, panel: { ...defaults.panel, message: { content: t('defaults.message') }, buttonLabel: t('defaults.button') } }),
  validateConfig: (config, guild) =>
    new EntityChecker(guild)
      .assignableRole(config.roleId, ['roleId'])
      .assignableRole(config.unverifiedRoleId, ['unverifiedRoleId'])
      .textChannel(config.logChannelId, ['logChannelId'])
      .textChannel(config.panel.channelId, ['panel', 'channelId']).issues,
  bot: {
    intents: [GatewayIntentBits.GuildMembers],
    commands: [verifyCommand, verificationCommand],
    components: { [PREFIX]: verificationComponent },
    events: { guildMemberAdd: onMemberJoin, guildMemberRemove: onMemberLeave },
  },
  jobs: { kick: kickUnverified },
  api: verificationApi,
});
