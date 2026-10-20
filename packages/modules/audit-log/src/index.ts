import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits, Partials } from 'discord.js';
import { commands } from './commands.js';
import { AuditLogConfig, defaultAuditLogConfig, LogCategory } from './config.js';
import { createHandlers, onCaseCreated } from './handlers.js';
import { locales } from './locales.js';

export { AuditLogConfig } from './config.js';

/** Server event log to chosen channels: messages, members, voice, server, bans. */
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
      // Message text requires the privileged Message Content intent.
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildInvites,
    ],
    // The bot caches neither messages nor all members — their events arrive as partials.
    partials: [Partials.Message, Partials.GuildMember, Partials.User],
    commands,
    events: createHandlers(),
    // Cases of the moderation commands arrive over the in-process bus, not from the gateway.
    setup: (ctx) => ctx.bus.on('moderation.caseCreated', (payload) => onCaseCreated(ctx, payload)),
  },
});
