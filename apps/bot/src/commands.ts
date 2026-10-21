import { localizedCommandPayloads, registerCoreLocales, type ModuleRegistry } from '@bot/core';
import { I18n } from '@bot/i18n';
import type { Logger } from '@bot/logger';
import {
  Routes,
  type APIApplicationCommand,
  type REST,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from 'discord.js';

type CommandBody = RESTPostAPIChatInputApplicationCommandsJSONBody | RESTPostAPIContextMenuApplicationCommandsJSONBody;

/** Slash commands have no `type` in our payloads; a user and a message menu command may share a name. */
const commandKey = (command: { type?: number; name: string }) => `${command.type ?? 1}:${command.name}`;

/** Slash command JSON of all modules with translations from their dictionaries. */
export function collectCommandPayloads(registry: ModuleRegistry): CommandBody[] {
  const i18n = new I18n();
  registerCoreLocales(i18n);
  registry.registerLocales(i18n);
  return localizedCommandPayloads(registry, i18n);
}

/** Command fields we set; the rest (id, version…) Discord adds itself. */
const COMPARED_KEYS = ['type', 'name', 'description', 'options', 'name_localizations', 'description_localizations', 'default_member_permissions', 'contexts'] as const;

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

/** `guild` — guild commands: Discord does not store `contexts` for them, so it is not compared. */
export function sameCommand(existing: Partial<APIApplicationCommand>, desired: CommandBody, scope: 'global' | 'guild' = 'global'): boolean {
  const keys = scope === 'guild' ? COMPARED_KEYS.filter((key) => key !== 'contexts') : COMPARED_KEYS;
  // Discord answers with `type` 1 for slash commands, which our payloads leave out.
  const pick = (command: object) => Object.fromEntries(keys.map((key) => [key, key === 'type' ? ((command as { type?: number }).type ?? 1) : (command as Record<string, unknown>)[key]]));
  return JSON.stringify(canonical(pick(existing))) === JSON.stringify(canonical(pick(desired)));
}

/** Without this flag Discord omits `*_localizations`, and every localized command would look changed. */
const WITH_LOCALIZATIONS = { query: new URLSearchParams({ with_localizations: 'true' }) };

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
    const existing = (await rest.get(globalRoute, WITH_LOCALIZATIONS)) as APIApplicationCommand[];
    const byKey = new Map(existing.map((c) => [commandKey(c), c]));
    const changed = existing.length !== body.length || body.some((command) => !byKey.has(commandKey(command)) || !sameCommand(byKey.get(commandKey(command))!, command));
    if (changed) {
      await rest.put(globalRoute, { body });
      for (const command of body) (byKey.has(commandKey(command)) ? result.updated : result.created).push(command.name);
    }
    return result;
  }

  // The guild also has custom commands — update one by one without touching anything else.
  const guildRoute = Routes.applicationGuildCommands(appId, guildId);
  const existing = new Map(((await rest.get(guildRoute, WITH_LOCALIZATIONS)) as APIApplicationCommand[]).map((c) => [commandKey(c), c]));
  for (const command of body) {
    const current = existing.get(commandKey(command));
    if (!current) {
      await rest.post(guildRoute, { body: command });
      result.created.push(command.name);
    } else if (!sameCommand(current, command, 'guild')) {
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
