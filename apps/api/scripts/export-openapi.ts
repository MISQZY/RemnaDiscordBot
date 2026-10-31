import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleRegistry } from '@bot/core';
import { I18n } from '@bot/i18n';
import { createLogger } from '@bot/logger';
import { modules } from '@bot/module-list';
import type { ApiDeps } from '../src/deps.js';
import { buildServer } from '../src/server.js';

async function main() {
  const logger = createLogger({ service: 'openapi-export', level: 'silent', pretty: false });
  const registry = new ModuleRegistry(modules);
  const i18n = new I18n('ru');

  const dummyDeps: ApiDeps = {
    logger,
    db: {} as never,
    redis: {
      defineCommand: () => {},
      on: () => {},
    } as never,
    i18n,
    bus: {} as never,
    registry,
    config: {} as never,
    scheduler: {} as never,
    guildLocales: { get: async () => 'ru' } as never,
    rest: {} as never,
    snapshots: {} as never,
    oauth: {} as never,
    options: {
      publicUrl: 'http://localhost:3000',
      webOrigin: 'http://localhost:3000',
      defaultRedirect: '/',
      clientId: '123456789012345678',
      sessionSecret: 'secret-must-be-at-least-32-chars-long!',
      secureCookies: false,
      docs: true,
      linkClients: [],
      rateLimitPerMinute: 0,
      botProfileEdits: true,
      trustedProxies: 0,
    },
  };

  const app = await buildServer(dummyDeps);
  try {
    await app.ready();
    const doc = app.swagger();
    const dirname = fileURLToPath(new URL('.', import.meta.url));
    const outPath = resolve(dirname, '../openapi.json');
    await writeFile(outPath, JSON.stringify(doc, null, 2), 'utf-8');
    console.log(`OpenAPI schema successfully exported to ${outPath}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
