import type { AnyModule } from '@bot/core';
import auditLog from '@bot/module-audit-log';
import autoroles from '@bot/module-autoroles';
import customCommands from '@bot/module-custom-commands';
import general from '@bot/module-general';
import leveling from '@bot/module-leveling';
import moderation from '@bot/module-moderation';
import music from '@bot/module-music';
import notifications from '@bot/module-notifications';
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
  auditLog,
  leveling,
  customCommands,
  notifications,
  music,
];
