import { ModuleRegistry } from '@bot/core';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import { REST, Routes } from 'discord.js';
import { collectCommandPayloads } from './commands.js';
import { loadDeployEnv } from './env.js';

/**
 * Регистрирует slash-команды всех модулей (bulk overwrite).
 * С DISCORD_DEV_GUILD_ID — в тестовую гильдию (применяется сразу), иначе или с `--global` — глобально.
 */
const env = loadDeployEnv();
const logger = createLogger({ service: 'deploy-commands', level: env.LOG_LEVEL });
const guildId = process.argv.includes('--global') ? undefined : env.DISCORD_DEV_GUILD_ID;

const body = collectCommandPayloads(new ModuleRegistry(modules));
const rest = new REST().setToken(env.DISCORD_TOKEN);
const route = guildId
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

await rest.put(route, { body });
logger.info({ scope: guildId ? `guild ${guildId}` : 'global', commands: body.map((c) => c.name) }, 'Slash commands deployed');
