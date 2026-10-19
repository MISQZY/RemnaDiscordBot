import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig, type ViteUserConfig } from 'vitest/config';

/** Integration tests — `*.int.test.ts` files. */
const INTEGRATION_PATTERN = 'src/**/*.int.test.ts';

/** Fast unit tests without a database or Redis. */
export function unitConfig(): ViteUserConfig {
  return defineConfig({
    test: {
      exclude: [...configDefaults.exclude, INTEGRATION_PATTERN],
    },
  });
}

/** Integration tests on SQLite and in-memory Redis — no containers. */
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
