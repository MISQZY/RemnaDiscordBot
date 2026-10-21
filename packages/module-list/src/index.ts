import type { AnyModule } from '@bot/core';
import auditLog from '@bot/module-audit-log';
import automod from '@bot/module-automod';
import autoroles from '@bot/module-autoroles';
import customCommands from '@bot/module-custom-commands';
import general from '@bot/module-general';
import giveaways from '@bot/module-giveaways';
import invites from '@bot/module-invites';
import leveling from '@bot/module-leveling';
import messages from '@bot/module-messages';
import moderation from '@bot/module-moderation';
import music from '@bot/module-music';
import notifications from '@bot/module-notifications';
import serverStats from '@bot/module-server-stats';
import starboard from '@bot/module-starboard';
import suggestions from '@bot/module-suggestions';
import tempVoice from '@bot/module-temp-voice';
import tickets from '@bot/module-tickets';
import verification from '@bot/module-verification';
import welcome from '@bot/module-welcome';

/**
 * Platform modules — a single list for the bot, the API and the worker.
 * The order defines the order in which event handlers run.
 */
export const modules: AnyModule[] = [
  general,
  welcome,
  autoroles,
  moderation,
  automod,
  verification,
  tickets,
  messages,
  tempVoice,
  giveaways,
  serverStats,
  invites,
  suggestions,
  starboard,
  auditLog,
  leveling,
  customCommands,
  notifications,
  music,
];
