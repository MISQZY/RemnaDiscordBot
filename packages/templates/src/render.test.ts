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

  it('substitutes keys in any script', () => {
    expect(renderText('«{цитата}» — {автор}', { цитата: 'Знание — сила', автор: '<@1>' })).toBe('«Знание — сила» — <@1>');
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

  it('renders all embed fields with placeholders including URLs, colors, and timestamps', () => {
    const customVars = {
      ...vars,
      'video.url': 'https://youtube.com/watch?v=123',
      'user.avatar': 'https://cdn.test/user.png',
      'item.image': 'https://cdn.test/item.png',
      'guild.icon': 'https://cdn.test/guild.png',
      accentColor: '#5865f2',
      eventDate: '2026-10-31T20:00:00.000Z',
    };

    const message = renderMessage(
      {
        embeds: [
          {
            title: 'Title: {guild.name}',
            description: 'Hello {user.name}',
            url: '{video.url}',
            color: '{accentColor}',
            author: { name: '{user.name}', url: '{video.url}', iconUrl: '{user.avatar}' },
            thumbnailUrl: '{item.image}',
            imageUrl: '{item.image}',
            footer: { text: 'Server: {guild.name}', iconUrl: '{guild.icon}' },
            timestamp: '{eventDate}',
            fields: [{ name: 'Field {level}', value: 'Value {user.displayName}', inline: true }],
          },
        ],
      },
      customVars,
    );

    expect(message.embeds?.[0]).toEqual({
      title: 'Title: Zion',
      description: 'Hello neo',
      url: 'https://youtube.com/watch?v=123',
      color: 0x5865f2,
      author: {
        name: 'neo',
        url: 'https://youtube.com/watch?v=123',
        icon_url: 'https://cdn.test/user.png',
      },
      thumbnail: { url: 'https://cdn.test/item.png' },
      image: { url: 'https://cdn.test/item.png' },
      footer: {
        text: 'Server: Zion',
        icon_url: 'https://cdn.test/guild.png',
      },
      timestamp: '2026-10-31T20:00:00.000Z',
      fields: [{ name: 'Field 5', value: 'Value Neo', inline: true }],
    });
  });

  it('renders user mentions cleanly across plain and rich embed fields', () => {
    const message = renderMessage(
      {
        embeds: [
          {
            title: 'Welcome {user}',
            description: 'Hello {user} and <@id>',
            author: { name: '{user.mention}' },
            footer: { text: 'By {user}' },
            fields: [{ name: 'Member {user}', value: 'Giveaway winner: {user} (<@id>)', inline: true }],
          },
        ],
      },
      vars,
    );

    expect(message.embeds?.[0]).toMatchObject({
      title: 'Welcome @Neo',
      description: 'Hello <@1> and <@1>',
      author: { name: '@Neo' },
      footer: { text: 'By @Neo' },
      fields: [{ name: 'Member @Neo', value: 'Giveaway winner: <@1> (<@1>)', inline: true }],
    });
  });

  it('truncates long fields to Discord limits', () => {
    const message = renderMessage({ content: 'x'.repeat(3000), embeds: [{ title: 't'.repeat(300) }] }, vars);

    expect(message.content).toHaveLength(2000);
    expect(message.embeds?.[0]?.title).toHaveLength(256);
  });

  it('parses complete color values and rejects partial numeric strings', () => {
    const color = (value: string) => renderMessage({ embeds: [{ title: 'Color', color: '{color}' }] }, { color: value }).embeds?.[0]?.color;
    expect(color('#5865f2')).toBe(0x5865f2);
    expect(color('0x5865f2')).toBe(0x5865f2);
    expect(color('16711680')).toBe(0xff0000);
    expect(color('ff0000')).toBe(0xff0000);
    expect(color('12garbage')).toBeUndefined();
    expect(color('#ffjunk')).toBeUndefined();
  });

  it('drops embeds beyond the total size limit', () => {
    const big = { description: 'd'.repeat(4000) };
    expect(renderMessage({ embeds: [big, big] }, vars).embeds).toHaveLength(1);
  });

  it('keeps only http(s) URLs for images', () => {
    const message = renderMessage({ embeds: [{ title: 'x', imageUrl: 'javascript:alert(1)', thumbnailUrl: 'https://cdn.test/a.png' }] }, vars);
    expect(message.embeds?.[0]).toEqual({ title: 'x', thumbnail: { url: 'https://cdn.test/a.png' } });
    const bad = renderMessage({ embeds: [{ title: 'x', url: '{bad}', imageUrl: '{bad}', author: { name: 'Author', url: '{bad}' } }] }, { bad: 'https://invalid host/image.png' });
    expect(bad.embeds?.[0]).toEqual({ title: 'x', author: { name: 'Author' } });
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

describe('mentions in values', () => {
  const template = { content: '{user.mention} says: {args}', allowedMentions: { users: true, roles: true, everyone: true } };

  it("keeps what members wrote from pinging, the bot's own mentions still ping", () => {
    const { content } = renderMessage(template, { 'user.mention': '<@1>', args: 'hi <@2> <@&3> @everyone @here' });
    expect(content).toBe('<@1> says: hi <@​2> <@​&3> @​everyone @​here');
  });

  it('lets resolved option mentions ping when asked to', () => {
    const { content } = renderMessage({ content: '{who}' }, { who: '<@5>' }, { mentionKeys: ['who'] });
    expect(content).toBe('<@5>');
  });

  it("does not touch the template's own text", () => {
    expect(renderMessage({ content: '@everyone <@&3> {x}', allowedMentions: { users: true, roles: true, everyone: true } }, { x: 'ok' }).content).toBe(
      '@everyone <@&3> ok',
    );
  });
});
