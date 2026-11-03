import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { include: ['test/postgres.integration.test.ts'], maxWorkers: 1, hookTimeout: 120_000, testTimeout: 30_000 },
});
