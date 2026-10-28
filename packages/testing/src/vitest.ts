import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig, type ViteUserConfig } from 'vitest/config';

/** A key for SecretBox: modules that keep secrets read it from the environment. */
const env = { SECRETS_KEY: 'test-secrets-key-test-secrets-key' };

/** Integration tests — `*.int.test.ts` files. */
const INTEGRATION_PATTERN = 'src/**/*.int.test.ts';

/** Fast unit tests without a database or Redis. */
export function unitConfig(): ViteUserConfig {
  return defineConfig({
    test: {
      exclude: [...configDefaults.exclude, INTEGRATION_PATTERN],
      env,
    },
  });
}

/** Integration tests on SQLite and in-memory Redis — no containers. */
export function integrationConfig(): ViteUserConfig {
  return defineConfig({
    test: {
      include: [INTEGRATION_PATTERN],
      env,
      globalSetup: [fileURLToPath(new URL('./global-setup.js', import.meta.url))],
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  });
}
