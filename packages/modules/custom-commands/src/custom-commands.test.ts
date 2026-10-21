import { describe, expect, it } from 'vitest';
import { ApplicationCommandOptionType } from 'discord.js';
import { isAllowed } from './bot.js';
import { CommandInput } from './config.js';
import { slashCommandBody } from './discord-sync.js';
import { matchTrigger, regexProblem } from './matching.js';

const trigger = (matchMode: string, pattern: string) => ({ id: `${matchMode}:${pattern}`, matchMode, pattern });

describe('matchTrigger', () => {
  it('matches exact text case-insensitively', () => {
    expect(matchTrigger(trigger('exact', 'Привет'), '  привет ')).toEqual({ args: '' });
    expect(matchTrigger(trigger('exact', 'привет'), 'привет всем')).toBeNull();
  });

  it('matches a prefix only on a word boundary and returns the rest as args', () => {
    expect(matchTrigger(trigger('startsWith', '!rules'), '!rules 3')).toEqual({ args: '3' });
    expect(matchTrigger(trigger('startsWith', '!rules'), '!rulesx')).toBeNull();
  });

  it('matches substrings and regex groups', () => {
    expect(matchTrigger(trigger('contains', 'discord'), 'I love Discord!')).toEqual({ args: '' });
    expect(matchTrigger(trigger('regex', 'погода в (\\p{L}+)'), 'какая погода в Москве?')).toEqual({ args: 'Москве' });
  });
});

describe('regexProblem', () => {
  it('rejects invalid patterns and nested quantifiers', () => {
    expect(regexProblem('[a-')).toBe('Invalid regular expression');
    expect(regexProblem('(a+)+$')).toMatch(/Nested quantifiers/);
    expect(regexProblem('(\\w*)*')).toMatch(/Nested quantifiers/);
    expect(regexProblem('hello (\\w+)')).toBeNull();
  });
});

describe('CommandInput', () => {
  const base = { response: { content: 'ok' } };

  it('requires Discord-compatible slash names', () => {
    expect(CommandInput.safeParse({ ...base, kind: 'slash', name: 'rules' }).success).toBe(true);
    expect(CommandInput.safeParse({ ...base, kind: 'slash', name: 'Rules!' }).success).toBe(false);
    expect(CommandInput.safeParse({ ...base, kind: 'slash', name: 'правила' }).success).toBe(true);
  });

  it('requires a pattern for triggers and validates regex', () => {
    expect(CommandInput.safeParse({ ...base, kind: 'trigger', name: 'hi' }).success).toBe(false);
    expect(CommandInput.safeParse({ ...base, kind: 'trigger', name: 'hi', matchMode: 'regex', pattern: '(a+)+' }).success).toBe(false);
    expect(CommandInput.safeParse({ ...base, kind: 'trigger', name: 'hi', matchMode: 'contains', pattern: 'hi' }).success).toBe(true);
  });
});

describe('slashCommandBody', () => {
  it('adds a text option only when the response uses {args}', () => {
    expect(slashCommandBody({ name: 'say', description: null, response: { content: '{args}' }, options: [] }).options).toHaveLength(1);
    expect(slashCommandBody({ name: 'rules', description: 'Rules', response: { content: 'Be nice' }, options: [] })).toMatchObject({
      name: 'rules',
      description: 'Rules',
      options: [],
    });
  });

  it('puts its own options instead of {args}, the required ones first', () => {
    const body = slashCommandBody({
      name: 'цитата',
      description: null,
      response: { content: '{args} «{цитата}» — {автор}' },
      options: [
        { name: 'автор', description: 'Кто сказал', type: 'user', required: false },
        { name: 'цитата', description: 'Текст', type: 'string', required: true },
      ],
    });
    expect(body.options?.map((o) => [o.name, o.type, o.required])).toEqual([
      ['цитата', ApplicationCommandOptionType.String, true],
      ['автор', ApplicationCommandOptionType.User, false],
    ]);
  });
});

describe('CommandInput options', () => {
  const base = { name: 'quote', kind: 'slash', response: { content: '{q}' } } as const;
  it('takes names in any script and refuses built-in placeholders and repeats', () => {
    const option = (name: string) => ({ name, description: 'x', type: 'string', required: true });
    expect(CommandInput.safeParse({ ...base, options: [option('цитата'), option('author_2')] }).success).toBe(true);
    expect(CommandInput.safeParse({ ...base, options: [option('user')] }).success).toBe(false);
    expect(CommandInput.safeParse({ ...base, options: [option('a'), option('a')] }).success).toBe(false);
    expect(CommandInput.safeParse({ ...base, options: [option('Bad')] }).success).toBe(false);
    expect(CommandInput.safeParse({ ...base, options: [option('с-дефисом')] }).success).toBe(false);
  });
});

describe('isAllowed', () => {
  it('treats empty lists as unrestricted', () => {
    expect(isAllowed({ allowedChannelIds: [], allowedRoleIds: [] }, 'c', [])).toBe(true);
    expect(isAllowed({ allowedChannelIds: ['c1'], allowedRoleIds: [] }, 'c2', [])).toBe(false);
    expect(isAllowed({ allowedChannelIds: [], allowedRoleIds: ['vip'] }, 'c', ['vip'])).toBe(true);
  });
});
