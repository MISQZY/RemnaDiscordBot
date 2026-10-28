import { describe, expect, it } from 'vitest';
import { formatValue } from './format.js';
import { renderMessage, renderText } from './render.js';

// Intl puts a narrow no-break space between groups in Russian.
const ru = (text: string) => text.replace(/\s/g, ' ');

describe('formatValue', () => {
  it('groups digits the locale way, numbers given as numbers or text', () => {
    expect(formatValue(538270, ['number'], 'en')).toBe('538,270');
    expect(ru(formatValue('538270', ['number'], 'ru')!)).toBe('538 270');
    expect(formatValue(1234.5678, ['number'], 'en')).toBe('1,234.57');
  });

  it('rounds, fixes decimals, shortens and signs', () => {
    expect(formatValue(1627.6, ['round'], 'en')).toBe('1,628');
    expect(formatValue(-16.14491240915712, ['fixed1'], 'en')).toBe('-16.1');
    expect(ru(formatValue(-16.14491240915712, ['fixed1'], 'ru')!)).toBe('-16,1');
    expect(formatValue(2, ['fixed2'], 'en')).toBe('2.00');
    expect(formatValue(1627740, ['compact'], 'en')).toBe('1.6M');
    expect(formatValue(12.5, ['fixed1', 'signed'], 'en')).toBe('+12.5');
    expect(formatValue(0, ['signed'], 'en')).toBe('0');
    expect(formatValue(-103635, ['number', 'abs'], 'en')).toBe('103,635');
  });

  it('leaves what is not a number as it is, and refuses unknown or clashing formats', () => {
    expect(formatValue('2026-10-28', ['number'], 'en')).toBe('2026-10-28');
    expect(formatValue('12abc', ['number'], 'en')).toBe('12abc');
    expect(formatValue(5, ['money'], 'en')).toBeNull();
    expect(formatValue(5, ['round', 'compact'], 'en')).toBeNull();
  });

  it('falls back to English for a locale Intl does not know', () => {
    expect(formatValue(1000, ['number'], 'not a locale')).toBe('1,000');
  });
});

describe('placeholders with formats', () => {
  const vars = { 'item.price': 538270, 'item.percent': -16.14491240915712, 'item.day': '2026-10-28' };

  it('formats in text and leaves unknown formats as written', () => {
    expect(renderText('{item.price:number} ({item.percent:fixed1:signed}%) {item.day:number}', vars)).toBe('538,270 (-16.1%) 2026-10-28');
    expect(renderText('{item.price:money} {item.price}', vars)).toBe('{item.price:money} 538270');
    expect(renderText('{missing:number}', vars)).toBe('{missing:number}');
  });

  it('writes numbers in the guild language, in the text and in embeds', () => {
    const message = renderMessage({ content: '{item.price:number}', embeds: [{ title: '{item.percent:fixed1}' }] }, vars, { locale: 'ru' });
    expect(ru(message.content!)).toBe('538 270');
    expect(message.embeds?.[0]?.title).toBe('-16,1');
  });
});
