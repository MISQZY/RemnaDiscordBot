import { describe, expect, it } from 'vitest';
import { renderMessage, renderText, toRestMessage } from './render.js';
import { botVars, guildVars, userVars } from './vars.js';

const vars = {
  ...userVars({ id: '1', username: 'neo', globalName: 'Neo' }),
  ...guildVars({ id: '2', name: 'Zion', memberCount: 42 }),
  ...botVars({ id: '3', name: 'Oracle', avatarUrl: 'https://cdn.test/oracle.png' }),
  level: 5,
};

describe('renderText', () => {
  it('substitutes known placeholders and keeps unknown ones', () => {
    expect(renderText('Hi {user.mention} in {guild.name} ({guild.memberCount}), lvl {level} {unknown.key}', vars)).toBe(
      'Hi <@1> in Zion (42), lvl 5 {unknown.key}',
    );
  });

  it('substitutes the bot placeholders', () => {
    expect(renderText('{bot.name} {bot.mention} {bot.avatar}', vars)).toBe('Oracle <@3> https://cdn.test/oracle.png');
  });

  it('does not evaluate expressions', () => {
    expect(renderText('{constructor} {__proto__} {1+1}', vars)).toBe('{constructor} {__proto__} {1+1}');
  });
});

describe('renderMessage', () => {
  it('renders content and embeds with users-only mentions by default', () => {
    const message = renderMessage(
      {
        content: 'Welcome {user}!',
        embeds: [{ title: '{guild.name}', description: 'You are #{guild.memberCount}', fields: [{ name: 'Nick', value: '{user.displayName}', inline: true }] }],
      },
      vars,
    );

    expect(message).toEqual({
      content: 'Welcome <@1>!',
      embeds: [{ title: 'Zion', description: 'You are #42', fields: [{ name: 'Nick', value: 'Neo', inline: true }] }],
      allowedMentions: { parse: ['users'] },
    });
  });

  it('truncates long fields to Discord limits', () => {
    const message = renderMessage({ content: 'x'.repeat(3000), embeds: [{ title: 't'.repeat(300) }] }, vars);

    expect(message.content).toHaveLength(2000);
    expect(message.embeds?.[0]?.title).toHaveLength(256);
  });

  it('drops embeds beyond the total size limit', () => {
    const big = { description: 'd'.repeat(4000) };
    expect(renderMessage({ embeds: [big, big] }, vars).embeds).toHaveLength(1);
  });

  it('keeps only http(s) URLs for images', () => {
    const message = renderMessage({ embeds: [{ title: 'x', imageUrl: 'javascript:alert(1)', thumbnailUrl: 'https://cdn.test/a.png' }] }, vars);
    expect(message.embeds?.[0]).toEqual({ title: 'x', thumbnail: { url: 'https://cdn.test/a.png' } });
  });

  it('builds a REST body with allowed_mentions', () => {
    const body = toRestMessage(renderMessage({ content: 'hi', allowedMentions: { users: true, roles: true, everyone: false } }, vars));
    expect(body.allowed_mentions).toEqual({ parse: ['users', 'roles'] });
  });

  it('allows @everyone and @here apart, defusing the one not allowed', () => {
    const ZWSP = String.fromCodePoint(0x200b);
    const render = (everyone: boolean, here?: boolean) =>
      renderMessage({ content: '@everyone @here @heresy', allowedMentions: { users: true, roles: false, everyone, here } }, vars);

    expect(render(false, true)).toMatchObject({ content: `@${ZWSP}everyone @here @heresy`, allowedMentions: { parse: ['users', 'everyone'] } });
    expect(render(true, false)).toMatchObject({ content: `@everyone @${ZWSP}here @heresy`, allowedMentions: { parse: ['users', 'everyone'] } });
    expect(render(false, false)).toMatchObject({ content: '@everyone @here @heresy', allowedMentions: { parse: ['users'] } });
    // Saved before the split: one switch for both.
    expect(render(true)).toMatchObject({ content: '@everyone @here @heresy', allowedMentions: { parse: ['users', 'everyone'] } });
  });
});
