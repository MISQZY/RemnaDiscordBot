import { describe, expect, it } from 'vitest';
import { MessageTemplate, ModuleId, Snowflake } from './index.js';

describe('Snowflake', () => {
  it('accepts Discord IDs', () => {
    expect(Snowflake.safeParse('123456789012345678').success).toBe(true);
  });

  it('rejects non-numeric and short values', () => {
    expect(Snowflake.safeParse('abc').success).toBe(false);
    expect(Snowflake.safeParse('12345').success).toBe(false);
  });
});

describe('ModuleId', () => {
  it('accepts kebab-case IDs', () => {
    expect(ModuleId.safeParse('audit-log').success).toBe(true);
  });

  it('rejects uppercase and leading digits', () => {
    expect(ModuleId.safeParse('AuditLog').success).toBe(false);
    expect(ModuleId.safeParse('1log').success).toBe(false);
  });
});

describe('MessageTemplate', () => {
  it('accepts content-only messages', () => {
    expect(MessageTemplate.safeParse({ content: 'Привет, {user.mention}!' }).success).toBe(true);
  });

  it('accepts embed-only messages', () => {
    expect(MessageTemplate.safeParse({ embeds: [{ title: 'Hi' }] }).success).toBe(true);
  });

  it('rejects empty messages', () => {
    expect(MessageTemplate.safeParse({ content: '  ' }).success).toBe(false);
    expect(MessageTemplate.safeParse({}).success).toBe(false);
  });
});
