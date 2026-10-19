import { I18n } from '@bot/i18n';
import { SlashCommandBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { localizeCommand } from './command-locales.js';

const command = new SlashCommandBuilder()
  .setName('greet')
  .setDescription('fallback')
  .addSubcommand((sub) =>
    sub
      .setName('send')
      .setDescription('fallback')
      .addStringOption((o) =>
        o.setName('kind').setDescription('fallback').addChoices({ name: 'Join', value: 'join' }, { name: 'Leave', value: 'leave' }),
      ),
  );

const i18n = new I18n('ru');
i18n.register('welcome', {
  ru: {
    commands: {
      greet: {
        description: 'Приветствия',
        send: {
          description: 'Отправить',
          options: { kind: { name: 'тип', description: 'Какое сообщение', choices: { join: 'Вход' } } },
        },
      },
    },
  },
  en: {
    commands: {
      greet: {
        description: 'Greetings',
        send: { description: 'Send', options: { kind: { name: 'kind', description: 'Which message', choices: { join: 'Join' } } } },
      },
    },
  },
});

describe('localizeCommand', () => {
  const json = localizeCommand(command.toJSON(), i18n, 'welcome') as unknown as {
    name: string;
    name_localizations?: unknown;
    description: string;
    description_localizations: Record<string, string>;
    options: {
      description: string;
      description_localizations: Record<string, string>;
      options: { name_localizations: Record<string, string>; description: string; choices: { name: string; name_localizations?: Record<string, string> }[] }[];
    }[];
  };

  it('uses English as the base text and adds Discord localizations', () => {
    expect(json.description).toBe('Greetings');
    expect(json.description_localizations).toEqual({ ru: 'Приветствия', 'en-US': 'Greetings', 'en-GB': 'Greetings' });
  });

  it('keeps the top-level command name stable', () => {
    expect(json.name).toBe('greet');
    expect(json.name_localizations).toBeUndefined();
  });

  it('localizes subcommands, option names and choices', () => {
    const sub = json.options[0]!;
    const kind = sub.options[0]!;
    expect(sub.description_localizations.ru).toBe('Отправить');
    expect(kind.name_localizations).toEqual({ ru: 'тип' });
    expect(kind.description).toBe('Which message');
    expect(kind.choices[0]).toMatchObject({ name: 'Join', name_localizations: { ru: 'Вход' } });
  });

  it('falls back to the builder text when a key is missing', () => {
    expect(json.options[0]!.options[0]!.choices[1]).toEqual({ name: 'Leave', value: 'leave' });
  });
});
