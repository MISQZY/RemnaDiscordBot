import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { ticketsApi } from './api.js';
import { onChannelGone, onMessage, ticketComponent } from './bot.js';
import { ticketCommand } from './commands.js';
import { defaultTicketsConfig, TicketsConfig } from './config.js';
import { autoClose } from './jobs.js';
import { locales } from './locales.js';
import { PREFIX } from './panel.js';

export { TicketDto, TicketPanel, TicketPanelInput, TicketsConfig } from './config.js';

/** Support tickets: panels with categories and questions, private threads or channels, transcripts, auto-close. */
export default defineModule({
  id: 'tickets',
  configSchema: TicketsConfig,
  defaultConfig: defaultTicketsConfig,
  configVersion: 1,
  locales,
  localizeDefaults: (defaults, t) => ({ ...defaults, openMessage: { content: t('defaults.openMessage') } }),
  validateConfig: (config, guild) => {
    const checker = new EntityChecker(guild).roles(config.supportRoleIds, ['supportRoleIds']).textChannel(config.logChannelId, ['logChannelId']);
    // Threads go under a text channel, ticket channels under a category.
    if (config.parentChannelId) {
      const parent = guild.channels.find((c) => c.id === config.parentChannelId);
      const wanted = config.mode === 'thread' ? [0] : [4];
      if (!parent) checker.issues.push({ path: ['parentChannelId'], message: `Channel ${config.parentChannelId} not found` });
      else if (!wanted.includes(parent.type)) {
        checker.issues.push({ path: ['parentChannelId'], message: config.mode === 'thread' ? 'Threads need a text channel' : 'Ticket channels need a category' });
      }
    }
    return checker.issues;
  },
  bot: {
    intents: [GatewayIntentBits.GuildMessages],
    commands: [ticketCommand],
    components: { [PREFIX]: ticketComponent },
    events: { messageCreate: onMessage },
    housekeeping: { channelDelete: onChannelGone, threadDelete: onChannelGone },
  },
  intervals: { autoClose: { everyMs: 10 * 60_000, run: (ctx) => autoClose(ctx).then(() => undefined) } },
  api: ticketsApi,
});
