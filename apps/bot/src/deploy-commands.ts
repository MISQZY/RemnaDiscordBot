import { ModuleRegistry } from '@bot/core';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { REST } from 'discord.js';
import { collectCommandPayloads, syncCommands } from './commands.js';
import { loadDeployEnv } from './env.js';

/**
 * Manual slash command sync (usually not needed: the bot does it on startup).
 * With DISCORD_DEV_GUILD_ID — into the dev guild, otherwise or with `--global` — globally.
 */
const env = loadDeployEnv();
const logger = createLogger({ service: 'deploy-commands', level: env.LOG_LEVEL });
const guildId = process.argv.includes('--global') ? undefined : env.DISCORD_DEV_GUILD_ID;

const result = await syncCommands(new REST().setToken(env.DISCORD_TOKEN), collectCommandPayloads(new ModuleRegistry(modules)), {
  guildId,
  applicationId: env.DISCORD_CLIENT_ID,
  logger,
});
logger.info(result, 'Slash commands synced');
