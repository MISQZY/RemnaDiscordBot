import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, push } from '@bot/db/sqlite-tools';
import type { TestProject } from 'vitest/node';

/** Готовит SQLite-шаблон со схемой один раз на запуск; тесты копируют его в свои базы. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  generate();

  const dir = await mkdtemp(join(tmpdir(), 'bot-test-template-'));
  const template = join(dir, 'template.db');
  push(template);
  project.provide('sqliteTemplatePath', template);

  return () => rm(dir, { recursive: true, force: true });
}
