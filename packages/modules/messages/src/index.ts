import { defineModule } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { z } from 'zod';
import { messagesApi } from './api.js';
import { clearStickyTimers, onMessage } from './bot.js';
import { remindCommand, stickyCommand } from './commands.js';
import { defaultMessagesConfig, MessagesConfig } from './config.js';
import { locales } from './locales.js';
import { sendReminder } from './reminders.js';
import { MessageService } from './service.js';

export { MessagesConfig, ScheduledDto, ScheduledInput, SendInput, SentMessage, StickyDto, StickyInput } from './config.js';

const ById = z.object({ id: z.string() });

/** The bot's messages: posted and edited from the dashboard, on schedule, sticky at the bottom; members' reminders. */
export default defineModule({
  id: 'messages',
  configSchema: MessagesConfig,
  defaultConfig: defaultMessagesConfig,
  configVersion: 1,
  locales,
  bot: {
    intents: [GatewayIntentBits.GuildMessages],
    commands: [remindCommand, stickyCommand],
    events: { messageCreate: onMessage },
    setup: () => clearStickyTimers,
    // A deleted channel takes its sticky message along, the module on or off.
    housekeeping: { channelDelete: (ctx, channel) => new MessageService(ctx).dropChannel(channel.id) },
  },
  jobs: {
    // Runs while the module is off as well: it skips the post itself, but plans the next run of a repeating message.
    scheduled: { whenDisabled: 'run', run: (payload, ctx) => new MessageService(ctx).runScheduled(ById.parse(payload).id) },
    remind: (payload, ctx) => sendReminder(ctx, ById.parse(payload).id),
  },
  api: messagesApi,
});
