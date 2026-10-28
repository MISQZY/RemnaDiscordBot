import { describe, expect, it } from 'vitest';
import { formatDate, isDateMask, parseDate } from './date.js';
import { formatValue } from './format.js';
import { renderText } from './render.js';

// Intl separates parts with no-break spaces in some languages.
const plain = (text: string) => text.replace(/\s/g, ' ');
const NOW = Date.parse('2026-10-29T12:00:00Z');

describe('parseDate', () => {
  it('reads ISO days and moments, feed dates and Unix time', () => {
    expect(parseDate('2026-10-28')?.toISOString()).toBe('2026-10-28T00:00:00.000Z');
    expect(parseDate('2026-10-28T21:54:39.339874Z')?.toISOString()).toBe('2026-10-28T21:54:39.339Z');
    expect(parseDate('Tue, 27 Oct 2026 10:00:00 GMT')?.toISOString()).toBe('2026-10-27T10:00:00.000Z');
    expect(parseDate(1793224479)?.toISOString()).toBe('2026-10-28T21:54:39.000Z');
    expect(parseDate('1793224479000')?.toISOString()).toBe('2026-10-28T21:54:39.000Z');
  });

  it('does not take prices, words or short numbers for dates', () => {
    expect(parseDate(538270)).toBeNull();
    expect(parseDate('May')).toBeNull();
    expect(parseDate('1')).toBeNull();
    expect(parseDate('not 2026 a date')).toBeNull();
  });
});

describe('isDateMask', () => {
  it('knows masks from words', () => {
    for (const mask of ['dd.mm.yyyy', 'd mmmm', 'dd/mm/yy', 'yyyy-mm-dd', 'hh.mi', 'mmmm yyyy']) expect(isDateMask(mask), mask).toBe(true);
    for (const word of ['date', 'number', 'round', 'abs', 'signed', 'dd.mm.yyyyx', '..']) expect(isDateMask(word), word).toBe(false);
  });
});

describe('formatDate', () => {
  it('fills masks in UTC', () => {
    expect(formatDate('2026-10-28T21:54:39Z', 'dd.mm.yyyy', 'ru')).toBe('28.10.2026');
    expect(formatDate('2026-03-05', 'd.m.yy', 'ru')).toBe('5.3.26');
    expect(formatDate('2026-10-28T21:54:39Z', 'dd/mm/yyyy hh.mi', 'en')).toBe('28/10/2026 21.54');
    expect(formatDate('2026-10-28T23:30:00-05:00', 'dd.mm.yyyy', 'ru')).toBe('29.10.2026');
  });

  it('names months the language way, with a day and alone', () => {
    expect(formatDate('2026-10-28', 'd mmmm', 'ru')).toBe('28 октября');
    expect(formatDate('2026-10-28', 'mmmm yyyy', 'ru')).toBe('октябрь 2026');
    expect(formatDate('2026-10-28', 'd mmmm yyyy', 'en')).toBe('28 October 2026');
    expect(formatDate('2026-10-28', 'd mmm', 'ru')).toBe('28 окт.');
  });

  it('has named formats; a day alone gets no time', () => {
    expect(plain(formatDate('2026-10-28', 'date', 'ru'))).toBe('28 октября 2026 г.');
    expect(plain(formatDate('2026-10-28T21:54:39Z', 'datetime', 'en'))).toBe('October 28, 2026 at 9:54 PM');
    expect(plain(formatDate('2026-10-28', 'datetime', 'en'))).toBe('October 28, 2026');
    expect(formatDate('2026-10-28T21:54:39Z', 'time', 'ru')).toBe('21:54');
  });

  it('says how long ago, by days for a day', () => {
    expect(formatDate('2026-10-28', 'relative', 'ru', NOW)).toBe('вчера');
    expect(formatDate('2026-10-29', 'relative', 'en', NOW)).toBe('today');
    expect(formatDate('2026-10-26', 'relative', 'en', NOW)).toBe('3 days ago');
    expect(formatDate('2026-10-29T11:55:00Z', 'relative', 'en', NOW)).toBe('5 minutes ago');
    expect(formatDate('2026-10-29T14:00:00Z', 'relative', 'en', NOW)).toBe('in 2 hours');
    expect(formatDate('2026-10-29T12:00:00Z', 'relative', 'en', NOW)).toBe('now');
  });

  it('leaves what is not a date as it is', () => {
    expect(formatDate('soon', 'dd.mm.yyyy', 'ru')).toBe('soon');
  });
});

describe('date placeholders', () => {
  const vars = { 'item.day': '2026-10-28', 'item.price': 538270 };

  it('format in text, with spaces and dots in the mask', () => {
    expect(renderText('{item.day:dd.mm.yyyy} · {item.day:d mmmm}', vars, undefined, 'ru')).toBe('28.10.2026 · 28 октября');
  });

  it('stand alone: with another format the placeholder stays as written', () => {
    expect(formatValue('2026-10-28', ['date', 'signed'])).toBeNull();
    expect(renderText('{item.day:dd.mm.yyyy:number} {item.price:dd.mm.yyyy}', vars)).toBe('{item.day:dd.mm.yyyy:number} 538270');
  });
});
