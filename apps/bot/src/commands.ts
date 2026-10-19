import type { ModuleRegistry } from '@bot/core';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

export function collectCommandPayloads(registry: ModuleRegistry): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return registry.allCommands().map(({ item }) => item.data.toJSON());
}
