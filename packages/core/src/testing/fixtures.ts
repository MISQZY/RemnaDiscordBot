import { createLogger } from '@bot/logger';
import { z } from 'zod';
import { defineCommand, defineModule } from '../module.js';

export const testLogger = createLogger({ service: 'test', level: 'silent', pretty: false });

export const LevelingConfig = z.object({
  xpPerMessage: z.number().int().min(1),
  announce: z.boolean(),
});

export function createTestModule(id = 'leveling', overrides: Partial<Parameters<typeof defineModule>[0]> = {}) {
  return defineModule({
    id,
    configSchema: LevelingConfig,
    defaultConfig: { xpPerMessage: 10, announce: true },
    configVersion: 1,
    bot: {
      commands: [
        defineCommand({
          data: { name: `${id}-rank`, toJSON: () => ({ name: `${id}-rank`, description: 'rank' }) },
          async execute() {},
        }),
      ],
      components: { [`${id}-btn`]: { async handle() {} } },
      events: { messageCreate: () => {} },
    },
    ...overrides,
  });
}
