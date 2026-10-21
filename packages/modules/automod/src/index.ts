import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { automodApi } from './api.js';
import { onMessage, onMessageEdit } from './bot.js';
import { automodCommand } from './commands.js';
import { AutomodConfig, defaultAutomodConfig, FILTERS } from './config.js';
import { locales } from './locales.js';
import { onMemberJoin } from './raid.js';

export { AutomodConfig } from './config.js';
export { NativeRule, NativeRuleInput } from './native.js';

/** Message filters (invites, links, caps, spam, words…), raid protection and an account age gate. */
export default defineModule({
  id: 'automod',
  configSchema: AutomodConfig,
  defaultConfig: defaultAutomodConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) => {
    const checker = new EntityChecker(guild)
      .textChannel(config.logChannelId, ['logChannelId'])
      .roles(config.exemptRoleIds, ['exemptRoleIds'])
      .channels(config.exemptChannelIds, ['exemptChannelIds'])
      .textChannel(config.raid.alertChannelId, ['raid', 'alertChannelId'])
      .role(config.raid.alertRoleId, ['raid', 'alertRoleId'])
      .textChannel(config.honeypot.channelId, ['honeypot', 'channelId']);
    for (const name of FILTERS) {
      checker.roles(config.filters[name].exemptRoleIds, ['filters', name, 'exemptRoleIds']).channels(config.filters[name].exemptChannelIds, ['filters', name, 'exemptChannelIds']);
    }
    return checker.issues;
  },
  bot: {
    // Message text needs the privileged Message Content intent, joins — Server Members.
    intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    commands: [automodCommand],
    events: {
      messageCreate: onMessage,
      messageUpdate: onMessageEdit,
      guildMemberAdd: onMemberJoin,
    },
  },
  api: automodApi,
});
