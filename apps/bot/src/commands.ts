import { localizedCommandPayloads, registerCoreLocales, type ModuleRegistry } from '@bot/core';
import { I18n } from '@bot/i18n';
import type { Logger } from '@bot/logger';
import { Routes, type APIApplicationCommand, type REST, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

type CommandBody = RESTPostAPIChatInputApplicationCommandsJSONBody;

/** Slash command JSON of all modules with translations from their dictionaries. */
export function collectCommandPayloads(registry: ModuleRegistry): CommandBody[] {
  const i18n = new I18n();
  registerCoreLocales(i18n);
  registry.registerLocales(i18n);
  return localizedCommandPayloads(registry, i18n);
}

/** Command fields we set; the rest (id, version…) Discord adds itself. */
const COMPARED_KEYS = ['name', 'description', 'options', 'name_localizations', 'description_localizations', 'default_member_permissions', 'contexts'] as const;

/** Canonical form for comparison: no empty values and sorted keys. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, v]) => [key, canonical(v)] as const)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && v !== null && Object.keys(v).length === 0))
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

export function sameCommand(existing: Partial<APIApplicationCommand>, desired: CommandBody): boolean {
  const pick = (command: object) => Object.fromEntries(COMPARED_KEYS.map((key) => [key, (command as Record<string, unknown>)[key]]));
  return JSON.stringify(canonical(pick(existing))) === JSON.stringify(canonical(pick(desired)));
}

export interface SyncOptions {
  /** Dev guild: commands appear instantly; global ones are cleared to avoid duplicates. */
  guildId?: string;
  applicationId?: string;
  logger: Logger;
}

export interface SyncResult {
  scope: 'global' | 'guild';
  created: string[];
  updated: string[];
  clearedGlobal: boolean;
}

/**
 * Brings the modules' slash commands in Discord up to date, changing only differences:
 * Discord has a daily limit on command creation.
 */
export async function syncCommands(rest: REST, body: CommandBody[], { guildId, applicationId, logger }: SyncOptions): Promise<SyncResult> {
  const appId = applicationId ?? ((await rest.get(Routes.currentApplication())) as { id: string }).id;
  const globalRoute = Routes.applicationCommands(appId);
  const result: SyncResult = { scope: guildId ? 'guild' : 'global', created: [], updated: [], clearedGlobal: false };

  if (!guildId) {
    const existing = (await rest.get(globalRoute)) as APIApplicationCommand[];
    const byName = new Map(existing.map((c) => [c.name, c]));
    const changed = existing.length !== body.length || body.some((command) => !byName.has(command.name) || !sameCommand(byName.get(command.name)!, command));
    if (changed) {
      await rest.put(globalRoute, { body });
      for (const command of body) (byName.has(command.name) ? result.updated : result.created).push(command.name);
    }
    return result;
  }

  // The guild also has custom commands — update one by one without touching anything else.
  const guildRoute = Routes.applicationGuildCommands(appId, guildId);
  const existing = new Map(((await rest.get(guildRoute)) as APIApplicationCommand[]).map((c) => [c.name, c]));
  for (const command of body) {
    const current = existing.get(command.name);
    if (!current) {
      await rest.post(guildRoute, { body: command });
      result.created.push(command.name);
    } else if (!sameCommand(current, command)) {
      await rest.patch(Routes.applicationGuildCommand(appId, guildId, current.id), { body: command });
      result.updated.push(command.name);
    }
  }

  const globals = (await rest.get(globalRoute)) as APIApplicationCommand[];
  if (globals.length > 0) {
    await rest.put(globalRoute, { body: [] });
    result.clearedGlobal = true;
    logger.info({ commands: globals.map((c) => c.name) }, 'Cleared global commands to avoid duplicates in the dev guild');
  }
  return result;
}
