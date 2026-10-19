import { ModuleRegistry } from '@bot/core';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { REST } from 'discord.js';
import { collectCommandPayloads, syncCommands } from './commands.js';
import { loadDeployEnv } from './env.js';

/**
 * Ручная синхронизация slash-команд (обычно не нужна: бот делает это при старте).
 * С DISCORD_DEV_GUILD_ID — в тестовую гильдию, иначе или с `--global` — глобально.
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
