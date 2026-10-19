import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig, type ViteUserConfig } from 'vitest/config';

/** Интеграционные тесты — файлы `*.int.test.ts`. */
const INTEGRATION_PATTERN = 'src/**/*.int.test.ts';

/** Быстрые unit-тесты без БД и Redis. */
export function unitConfig(): ViteUserConfig {
  return defineConfig({
    test: {
      exclude: [...configDefaults.exclude, INTEGRATION_PATTERN],
    },
  });
}

/** Интеграционные тесты на SQLite и in-memory Redis — без контейнеров. */
export function integrationConfig(): ViteUserConfig {
  return defineConfig({
    test: {
      include: [INTEGRATION_PATTERN],
      globalSetup: [fileURLToPath(new URL('./global-setup.js', import.meta.url))],
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  });
}
