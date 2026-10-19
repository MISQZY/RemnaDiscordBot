import type { I18n } from '@bot/i18n';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { ModuleRegistry } from './registry.js';

type CommandJson = RESTPostAPIChatInputApplicationCommandsJSONBody;

interface Node {
  name: string;
  type?: number;
  description?: string;
  name_localizations?: Record<string, string> | null;
  description_localizations?: Record<string, string> | null;
  options?: Node[];
  choices?: { name: string; value: string | number; name_localizations?: Record<string, string> | null }[];
}

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;

/** Язык описаний «по умолчанию» в Discord — английский; остальные идут в `*_localizations`. */
const BASE_LOCALE = 'en';

/**
 * Тексты slash-команд из словарей модуля. Ключи:
 *   `<module>.commands.<cmd>.description`
 *   `<module>.commands.<cmd>.options.<opt>.name | .description | .choices.<value>`
 *   `<module>.commands.<cmd>.<sub>.description` (подкоманды и группы — вложенно)
 * Текст из билдера остаётся запасным, если ключа нет.
 */
export function localizeCommand(json: CommandJson, i18n: I18n, moduleId: string): CommandJson {
  const localized = structuredClone(json) as unknown as Node;
  localizeNode(localized, `${moduleId}.commands.${json.name}`, i18n, false);
  return localized as unknown as CommandJson;
}

function apply(i18n: I18n, key: string, current: string | undefined, localizations: Record<string, string> | null | undefined) {
  const map = i18n.localizations(key);
  if (Object.keys(map).length === 0) return { base: current, localizations };
  const base = i18n.has(key, BASE_LOCALE) ? i18n.raw(BASE_LOCALE, key) : current;
  return { base, localizations: { ...localizations, ...map } };
}

function localizeNode(node: Node, key: string, i18n: I18n, isOption: boolean): void {
  const description = apply(i18n, `${key}.description`, node.description, node.description_localizations);
  node.description = description.base;
  if (description.localizations) node.description_localizations = description.localizations;

  // Имя команды верхнего уровня не переводим: по нему её ищет диспетчер и пользователи в разных языках.
  if (isOption) {
    const names = i18n.localizations(`${key}.name`);
    delete names['en-US'];
    delete names['en-GB'];
    if (Object.keys(names).length > 0) node.name_localizations = { ...node.name_localizations, ...names };
  }

  for (const choice of node.choices ?? []) {
    const choiceKey = `${key}.choices.${choice.value}`;
    const localized = apply(i18n, choiceKey, choice.name, choice.name_localizations);
    choice.name = localized.base ?? choice.name;
    if (localized.localizations) choice.name_localizations = localized.localizations;
  }

  for (const child of node.options ?? []) {
    const nested = child.type === SUBCOMMAND || child.type === SUBCOMMAND_GROUP;
    localizeNode(child, nested ? `${key}.${child.name}` : `${key}.options.${child.name}`, i18n, true);
  }
}

/** JSON всех slash-команд модулей с переводами из словарей. */
export function localizedCommandPayloads(registry: ModuleRegistry, i18n: I18n): CommandJson[] {
  return registry.allCommands().map(({ module, item }) => localizeCommand(item.data.toJSON(), i18n, module.id));
}
